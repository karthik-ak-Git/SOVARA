/**
 * Mock EventSource for UI tests.
 *
 * The web client (`apps/web/src/lib/client/api.ts`) subscribes to server
 * push channels over SSE. In jsdom/node there is no EventSource, so tests
 * install this mock (see tests/setup.ts) and drive pushes explicitly via
 * `streamFor(urlPart).emit(payload)`.
 */
import { vi } from 'vitest'

export interface MockStream {
  url: string
  onmessage: ((msg: { data: string }) => void) | null
  onerror: (() => void) | null
  closed: boolean
  emit: (data: unknown) => void
  close: () => void
}

export const streamInstances: MockStream[] = []

export class MockEventSource {
  onmessage: ((msg: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    const self: MockStream = {
      url,
      get onmessage() {
        return selfRef.onmessage
      },
      set onmessage(fn) {
        selfRef.onmessage = fn
      },
      get onerror() {
        return selfRef.onerror
      },
      set onerror(fn) {
        selfRef.onerror = fn
      },
      get closed() {
        return selfRef.closed
      },
      emit: (data: unknown) => {
        selfRef.onmessage?.({ data: JSON.stringify(data) })
      },
      close: () => {
        selfRef.closed = true
      },
    }
    const selfRef = this
    // Rebind getters to the instance (defined above before selfRef init —
    // re-create plainly to keep it simple and correct):
    const stream: MockStream = {
      url,
      onmessage: null,
      onerror: null,
      closed: false,
      emit: (data: unknown) => {
        stream.onmessage?.({ data: JSON.stringify(data) })
      },
      close: () => {
        stream.closed = true
      },
    }
    void self
    streamInstances.push(stream)
    // Proxy property sets onto the registered stream record.
    Object.defineProperty(this, 'onmessage', {
      get: () => stream.onmessage,
      set: (fn) => {
        stream.onmessage = fn
      },
    })
    Object.defineProperty(this, 'onerror', {
      get: () => stream.onerror,
      set: (fn) => {
        stream.onerror = fn
      },
    })
    Object.defineProperty(this, 'closed', {
      get: () => stream.closed,
    })
  }

  close(): void {
    const s = streamInstances.find((x) => x.url === this.url && !x.closed)
    if (s) s.closed = true
  }
}

export function installEventSourceMock(): void {
  vi.stubGlobal('EventSource', MockEventSource)
}

/** Latest open stream whose URL contains `part` (e.g. '/api/chat/stream'). */
export function streamFor(part: string): MockStream {
  const found = [...streamInstances].reverse().find((s) => s.url.includes(part) && !s.closed)
  if (!found) throw new Error(`no open SSE stream matching: ${part}`)
  return found
}

export function resetStreams(): void {
  streamInstances.length = 0
}
