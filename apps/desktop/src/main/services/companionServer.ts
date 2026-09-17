// Lightweight loopback HTTP server serving __sovara/ping so the Vercel web app
// can detect the local desktop companion (see apps/web SystemConnect).
import * as http from 'node:http'
import { getFullHardwareProfile, hardwareFingerprint } from './hardwareProfile'

export const COMPANION_PORT = 51841

let server: http.Server | null = null

function pingPayload(): Record<string, unknown> {
  try {
    const hw = getFullHardwareProfile()
    return {
      hardwareId: hardwareFingerprint(hw),
      gpu: hw.gpu.name ?? null,
      vramMB: hw.gpu.vram_total_mb ?? 0,
      ramMB: hw.memory.ram_total_mb ?? 0,
      backend: hw.backend.name,
      version: 1,
    }
  } catch {
    // Hardware probe failure should not break ping — consumer still connects.
    return { hardwareId: String(process.pid), version: 1 }
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
} as const

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  })
  res.end(data)
}

export function startCompanionServer(port = COMPANION_PORT): http.Server {
  if (server) return server
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'GET' && url === '/__sovara/ping') {
      sendJson(res, 200, pingPayload())
      return
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...CORS_HEADERS,
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }
    sendJson(res, 404, { ok: false, error: 'not found' })
  })
  server.listen(port, '127.0.0.1')
  server.on('error', (err) => {
    // Port 51841 in use by another companion instance → ignore, ping served there.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') return
    console.error('[companion] http server error', err)
  })
  return server
}

export function stopCompanionServer(): void {
  if (!server) return
  server.close()
  server = null
}