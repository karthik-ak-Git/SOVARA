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
}

export const streamInstances: MockStream[] = []

export class MockEventSource {
  readonly url: string
  private stream: MockStream

  constructor(url: string) {
    this.url = url
    this.stream = {
      url,
      onmessage: null,
      onerror: null,
      closed: false,
      emit: (data: unknown) => {
        this.stream.onmessage?.({ data: JSON.stringify(data) })
      },
    }
    streamInstances.push(this.stream)
  }

  get onmessage(): ((msg: { data: string }) => void) | null {
    return this.stream.onmessage
  }

  set onmessage(fn: ((msg: { data: string }) => void) | null) {
    this.stream.onmessage = fn
  }

  get onerror(): (() => void) | null {
    return this.stream.onerror
  }

  set onerror(fn: (() => void) | null) {
    this.stream.onerror = fn
  }

  get closed(): boolean {
    return this.stream.closed
  }

  close(): void {
    this.stream.closed = true
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
