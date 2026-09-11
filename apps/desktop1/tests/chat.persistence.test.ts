import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqlitePersistenceAdapter } from '../src/main/backend/ports/SqlitePersistenceAdapter'
import { LlmStubAdapter, buildMockAssistantText } from '../src/main/backend/ports/LlmStubAdapter'
import { zChatSend } from '../src/shared/ipc/schemas'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-chat5-'))
}

/** Simulates the main-process `chat:send` flow without Electron. */
async function chatSend(p: SqlitePersistenceAdapter, sessionId: string, content: string) {
  const parsed = zChatSend.safeParse({ sessionId, content })
  if (!parsed.success) throw new Error(`invalid chat payload: ${parsed.error.message}`)
  const llm = new LlmStubAdapter()
  const userEv = await p.appendEvent(sessionId as never, 'user/message', { content })
  const chunks: string[] = []
  for await (const c of llm.stream(content)) {
    if (c.type === 'text-delta' && c.text) chunks.push(c.text)
    if (c.type === 'done') break
  }
  const assistantEv = await p.appendEvent(sessionId as never, 'assistant/message', {
    content: chunks.join('') || '[Phase 1 stub — no LLM wired]',
  })
  return { userEv, assistantEv }
}

describe('Commit 5 — durable conversation flow', () => {
  it('persists user + assistant events and reconstructs after recreation', async () => {
    const dir = mkTmp()
    const p1 = new SqlitePersistenceAdapter(dir)
    const h = await p1.create('chat')
    const { userEv, assistantEv } = await chatSend(p1, h.id as string, 'hello mock')
    expect(userEv.seq).toBe(0)
    expect(assistantEv.seq).toBe(1)
    await p1.close()

    const p2 = new SqlitePersistenceAdapter(dir)
    const evts = await p2.getEvents(h.id)
    expect(evts.map((e) => e.seq)).toEqual([0, 1])
    expect(evts[0].type).toBe('user/message')
    expect(evts[1].type).toBe('assistant/message')
    expect((evts[0].data as { content: string }).content).toBe('hello mock')
    expect((evts[1].data as { content: string }).content).toBe(buildMockAssistantText('hello mock'))
    // continue the conversation after reopen
    const cont = await chatSend(p2, h.id as string, 'second turn')
    expect(cont.userEv.seq).toBe(2)
    expect(cont.assistantEv.seq).toBe(3)
    await p2.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('switching sessions isolates timelines', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const a = await p.create('a')
    const b = await p.create('b')
    await chatSend(p, a.id as string, 'only-a')
    expect(await p.getEvents(a.id)).toHaveLength(2)
    expect(await p.getEvents(b.id)).toHaveLength(0)
    // returning to A reconstructs the same messages
    const again = await p.getEvents(a.id)
    expect((again[0].data as { content: string }).content).toBe('only-a')
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('empty sessions reconstruct as empty without errors', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('empty')
    expect(await p.getEvents(h.id)).toEqual([])
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('message ordering stays deterministic across many turns', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('s')
    for (let i = 0; i < 4; i++) await chatSend(p, h.id as string, `turn-${i}`)
    const evts = await p.getEvents(h.id)
    expect(evts.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(evts.map((e) => e.type)).toEqual([
      'user/message',
      'assistant/message',
      'user/message',
      'assistant/message',
      'user/message',
      'assistant/message',
      'user/message',
      'assistant/message',
    ])
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('very long messages are bounded by IPC validation (32k)', () => {
    expect(zChatSend.safeParse({ sessionId: 's', content: 'a'.repeat(32_000) }).success).toBe(true)
    expect(zChatSend.safeParse({ sessionId: 's', content: 'a'.repeat(32_001) }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: 's', content: '' }).success).toBe(false)
  })

  it('failed persistence throws and never fakes durability', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    await expect(p.appendEvent('missing' as never, 'user/message', { content: 'x' })).rejects.toThrow(
      /session not found/
    )
    await expect(chatSend(p, 'missing', 'x')).rejects.toThrow()
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('mock assistant cannot reach the network (source proof)', () => {
    const handlerSrc = fs.readFileSync('src/main/ipc/handlers.ts', 'utf8')
    const chatBlock = handlerSrc.slice(handlerSrc.indexOf("'chat:send'"))
    expect(chatBlock).not.toMatch(/\bfetch\s*\(/)
    expect(chatBlock).not.toMatch(/axios|XMLHttpRequest|net\.request/)
  })

  it('web chat layer has no fs/electron/database/subprocess access', () => {
    // Legacy Vite renderer (src/renderer) is deleted — check the Next.js UI
    // in apps/web. Same-origin fetch is allowed only inside the centralized
    // client (lib/client/api.ts); feature components must not call fetch.
    const featureFiles = [
      '../web/src/features/chat/ChatView.tsx',
      '../web/src/features/chat/MessageList.tsx',
      '../web/src/features/chat/MessageBubble.tsx',
      '../web/src/features/chat/Composer.tsx',
      '../web/src/features/chat/ConversationHeader.tsx',
      '../web/src/features/chat/conversation.ts',
      '../web/src/features/chat/useChatSession.ts',
    ]
    for (const f of featureFiles) {
      const txt = fs.readFileSync(f, 'utf8')
      expect(txt, `fs in ${f}`).not.toMatch(/from 'node:fs'|from "node:fs"|better-sqlite3/)
      expect(txt, `electron in ${f}`).not.toMatch(/from 'electron'|require\('electron'\)/)
      expect(txt, `fetch in ${f}`).not.toMatch(/\bfetch\s*\(/)
      expect(txt, `subprocess in ${f}`).not.toMatch(/from 'node:child_process'|require\(['"]child_process['"]\)/)
    }
    // Centralized client may fetch, but only same-origin /api routes.
    const clientSrc = fs.readFileSync('../web/src/lib/client/api.ts', 'utf8')
    expect(clientSrc).not.toMatch(/from 'electron'|require\('electron'\)/)
    expect(clientSrc).not.toMatch(/better-sqlite3|node:sqlite/)
    expect(clientSrc).not.toMatch(/fetch\(\s*['"`]https?:\/\//)
  })
})
