/**
 * Shared HTTP helpers for internal API routes.
 *
 * Conventions (mirroring the Electron IPC handlers' error contract):
 *  - Zod validation failure → 400 { error }
 *  - Unknown id / missing row  → 404 { error }
 *  - Backend failure           → 500 { error } (message only — never stack traces)
 *  - Success                   → 200 JSON (same shape the IPC handlers returned)
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

export function ok<T>(data: T, init?: number): NextResponse {
  return NextResponse.json(data, init ? { status: init } : undefined)
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 })
}

export function toErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

/** Read a JSON body, tolerating empty/missing bodies (returns {}). */
export async function readBody(req: Request): Promise<unknown> {
  try {
    const text = await req.text()
    if (!text) return {}
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

/**
 * Validate `raw` against a Zod schema. Returns the parsed data or a 400
 * response tuple. Usage:
 *   const [data, errorRes] = parseOr400(zChatSend, await readBody(req))
 *   if (errorRes) return errorRes
 */
export function parseOr400<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  label: string
): [T, null] | [null, NextResponse] {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return [null, badRequest(`invalid ${label}: ${parsed.error.message}`)]
  }
  return [parsed.data, null]
}

/** Prefix a user-facing error code exactly once (mirrors handlers.ts). */
export function prefixed(raw: string, prefix: string): string {
  return raw.toLowerCase().startsWith(prefix.toLowerCase()) ? raw : `${prefix}${raw}`
}

/** Map orchestrator error codes to the user-facing strings the UI handles. */
export function mapChatError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : fallback
  const code = (e as { code?: string })?.code
  if (code === 'no-model-available') return prefixed(raw, 'no-active-model: ')
  if (code === 'resource-blocked') return prefixed(raw, 'resource-pressure: ')
  if (code === 'model-load-failed' || code === 'runtime-unavailable') {
    return prefixed(raw, 'runtime-unavailable: ')
  }
  return raw
}
