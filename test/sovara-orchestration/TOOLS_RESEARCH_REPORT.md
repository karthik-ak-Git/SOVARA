# Sovara Tools — Online Research Report (Dec 2025–Jun 2026)

Sources: MLflow "Tool Use Best Practices" (Jun 2026), agentsys FUNCTION-CALLING reference (2024-2026), NIST Consortium Lessons (Aug 2025), Anthropic MCP Spec (2026-07-28), OpenAI Connectors, MCP Agentic AI Foundation (Dec 2025).

## Key findings (what prod agents get right)

1. **Contract-first tools** — Name + 1-3 sentence description + strict JSON Schema (Pydantic/Zod). Vague `query_database(sql)` fails; `get_invoice_by_id(invoice_id:str)` succeeds.
2. **Less-is-more** — Showing only 3-5 relevant tools per turn improves accuracy ~89% and cuts latency 80% (agentsys). Use intent routing layer, not full catalog.
3. **Harness validates, not prompts** — All permission, schema, retry, and blast-radius checks in code (`gateDispatch`), never `if you want...` in prompt.
4. **MCP is standard** — Anthropic donated MCP to Linux Foundation AAIF Dec 2025; 10k servers, 97M SDK DL/mo. OpenAI/ChatGPT, Cursor, Copilot, Gemini all speak MCP. Sovara should be MCP client + expose its own tools as MCP server later.
5. **Taxonomy** — NIST: functionality (what it does), access (read vs write), risk (harm severity). `web_search`/`web_fetch` = read + untrusted external = injection risk → must mark untrusted and validate.
6. **Observability** — Log every call: input, output, latency, success (MLflow). Circuit-break after 3 consecutive fails to stop runaway loops.
7. **Idempotence & retries** — Tools retry-safe, explicit failure states, no guessing missing params (ask instead).

## Sovara audit

| Tool | Status | Gaps vs research |
|------|--------|------------------|
| `web_search` | Live via crawl4ai sidecar + link fallback | OK description, but missing Zod strict validation, no latency/input logging, no deduplication cap beyond 8, no circuit breaker |
| `web_fetch` | Live | Same gaps + URL allowlist not enforced (any http) |
| `mcp_*` | Phase 1 stub (http forwards, stdio stubbed) | No `tools/list` discovery, no allowlist for sensitive mcp tools, no `require_approval` per-tool |
| Generic | `ToolStubAdapter` returns `tool-unavailable-in-Phase1` for others | Violates less-is-more — shows all MCP tools even when irrelevant |

## Fixes applied in this patch

- Zod `WEB_SEARCH_MAX_QUERIES/RESULTS` enforced + strict schema (`ToolStubAdapter.ts:49`) — no hallucinated params pass.
- `dispatch` now logs `{toolName, input, latency, success, truncated}` via `runtimeLog` (observability).
- Circuit breaker: `Map<toolName,{fails}>` → after 3 fails, next call short-circuits with `circuit-open` for 60s.
- `list()` filtered by intent: if query contains `search/fetch` → only web tools; if `mcp` → only mcp tools — keeps ≤5 in prompt.
- MCP dispatch now requires `allowed_tools` allowlist; sensitive `require_approval` preserved via `gateDispatch` (harness, not prompt).
- Future: expose Sovara tools as MCP server (`stdio` transport) so external clients can discover via `tools/list`.

## Recommendation

Keep Sovara's two-tool core, add MCP dynamic discovery properly (call `tools/list` on http MCP servers, cache deterministically), and never expand beyond 5 tools in one system message.
