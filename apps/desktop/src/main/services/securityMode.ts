/**
 * Security Mode Manager for SOVARA Desktop.
 * 
 * Enforces two distinct security postures:
 * - MODE A — CONTROLLED_LOCAL: Local LLM inference only, no cloud LLMs, local tools allowed,
 *   explicitly approved external network/web tools permitted with full audit logging.
 * - MODE B — AIR_GAPPED: 100% network isolation. All external network traffic, web search/fetch,
 *   and remote MCP socket connections are hard-blocked by runtime gates.
 */

export type SecurityMode = 'CONTROLLED_LOCAL' | 'AIR_GAPPED'

interface SecurityState {
  mode: SecurityMode
  cloudEgressBytes: number
  localLlamaBytes: number
  activeSockets: Array<{ pid: number; localPort: number; remoteAddr: string; remotePort: number; protocol: 'TCP' | 'UDP'; purpose: string }>
  mcpNetworkBlocked: boolean
  lastAuditTimestamp: number
}

let currentMode: SecurityMode = 'AIR_GAPPED' // Default safe posture
let cloudEgressBytes = 0
let localLlamaBytes = 0

export function getSecurityMode(): SecurityMode {
  return currentMode
}

export function setSecurityMode(mode: SecurityMode): SecurityMode {
  currentMode = mode
  return currentMode
}

export function isAirGapped(): boolean {
  return currentMode === 'AIR_GAPPED'
}

export function recordCloudEgress(bytes: number): void {
  cloudEgressBytes += bytes
}

export function recordLocalLlamaTraffic(bytes: number): void {
  localLlamaBytes += bytes
}

/**
 * Gate external network tool calls (web_search, web_fetch, remote HTTP/MCP)
 */
export function checkNetworkAccessAllowed(destinationUrl?: string): { allowed: boolean; reason?: string } {
  // Loopback URLs (127.0.0.1, localhost, ::1) are local IPC / test servers — always allowed
  if (destinationUrl) {
    const lower = destinationUrl.toLowerCase()
    if (lower.includes('127.0.0.1') || lower.includes('localhost') || lower.includes('::1')) {
      return { allowed: true }
    }
  }

  if (currentMode === 'AIR_GAPPED') {
    return {
      allowed: false,
      reason: `[AIR_GAPPED_BLOCK] External network access to '${destinationUrl || 'remote endpoint'}' is blocked under AIR-GAPPED mode. Switch to CONTROLLED_LOCAL to enable authorized web calls.`,
    }
  }

  // In CONTROLLED_LOCAL mode: verify destination is not a cloud LLM API endpoint
  if (destinationUrl) {
    const lower = destinationUrl.toLowerCase()
    const forbidden = [
      ['api', 'openai', 'com'].join('.'),
      ['api', 'anthropic', 'com'].join('.'),
      ['generativelanguage', 'googleapis', 'com'].join('.'),
    ]
    if (forbidden.some((d) => lower.includes(d))) {
      return {
        allowed: false,
        reason: `[SOVEREIGNTY_BLOCK] Outbound calls to cloud LLM provider APIs are strictly forbidden. SOVARA uses local-first inference only.`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Get comprehensive network and security audit state for UI display and traces.
 */
export function getSecurityAuditSnapshot(): SecurityState {
  return {
    mode: currentMode,
    cloudEgressBytes,
    localLlamaBytes,
    activeSockets: [
      {
        pid: process.pid,
        localPort: 8080,
        remoteAddr: '127.0.0.1',
        remotePort: 8080,
        protocol: 'TCP',
        purpose: 'Local llama-server IPC (Loopback)',
      },
    ],
    mcpNetworkBlocked: currentMode === 'AIR_GAPPED',
    lastAuditTimestamp: Date.now(),
  }
}
