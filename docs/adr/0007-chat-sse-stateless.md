# ADR-0007: Chat streaming via SSE with stateless turns

## Status

Accepted

## Context

Slice 1 needs progressive token delivery, real cancellation, and coherent
multi-turn conversation without building server-side memory, WebSocket
infrastructure, or a persistence layer.

## Decision

- Transport: `POST /api/v1/chat` returns `text/event-stream` (SSE) consumed
  with `fetch` + `ReadableStream` + `AbortController` (EventSource is GET-only
  and cannot carry a JSON body).
- Events: `token` (delta), `done` (model_id, finish_reason), `error`
  (code, message). Malformed lines are skipped, never fatal.
- Turns are stateless: the client sends full history; the backend validates,
  resolves, and forwards. Conversation persistence stays client-side
  (localStorage) until a server memory phase.
- Unknown models resolve before the first byte (JSON 502); mid-stream
  failures become one `error` event; disconnect aborts provider iteration.

## Consequences

Good: no WS server, no session store, cancellation is genuine, every failure
maps to the Phase 0 envelope or an `error` event.
Bad: full history re-sent per turn (fine at Slice 1 caps: 64 messages).
Mitigation: caps are settings (`SOVARA_CHAT_MAX_MESSAGES/_CHARS`).
