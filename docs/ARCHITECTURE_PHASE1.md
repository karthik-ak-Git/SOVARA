# Sovereign AI Desktop Workbench — Phase 1 Architecture Proposal

**Status:** `DRAFT — Corrected 2026-09-06. Awaiting re-approval. No implementation beyond this document.`
**Scope:** Architecture understanding + desktop foundation only. No agent, RAG, MCP, model-download logic yet.
**Sources traced:** `test/deepseek-harness/*`, `test/hermes-agent/*` (source, not README-only)
**Skills applied:** `desktop-app`, `electron-development`, `react-patterns`, `typescript-pro`, `ui-ux-pro-max`, `local-llm-expert`, `api-security-best-practices`, `database-design`, `testing-patterns`
**Ponytail level:** `full` — ladder enforced, shortest diff that holds wins.

**Corrections applied (2026-09-06):**
1. DSH/Hermes run **interface-only in Phase 1** — no Cordis runtime, no Hermes process. Stubs preserve the seam.
2. `ModelRuntimePort` is **runtime-agnostic** — no hard-coded llama.cpp. Adapters (llama.cpp / Ollama / LM Studio / vLLM / other) are Phase 2.
3. New first-class seam **`SystemResourceManagerPort`** for CPU/RAM/GPU/VRAM/disk/instance limits on corporate workstations (contract only in Phase 1).

---

## 1. System Architecture — One Picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Windows Desktop (.exe, Electron, offline by default)                   │
│                                                                         │
│  ┌──────────────┐   secure IPC (contextBridge + zod)   ┌─────────────┐ │
│  │  Renderer    │◄────────────────────────────────────►│    Main     │ │
│  │  React 18    │   invoke/handle (req/resp)           │  Node.js    │ │
│  │  TypeScript  │   webContents.send (push)            │  Electron   │ │
│  │  Tailwind    │                                      │             │ │
│  └──────────────┘                                      │  Owns:      │ │
│         ▲                                              │  • window/  │ │
│         │  reads only typed view models                │    lifecycle│ │
│         │                                              │  • IPC hub  │ │
│         │                                              │  • AppBackend│ │
│  ┌──────┴───────────────────────────────────────────────┴─────────────┐ │
│  │  AppBackend (Node, single process, started by Main)               │ │
│  │  Owns all ports. In Phase 1 every port behind it is a STUB — no  │ │
│  │  Cordis context, no Python child, no model sidecar is spawned.   │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │  Sovereign AI Core  (our interfaces, not theirs)            │ │ │
│  │  │  LlmPort  ToolPort  SandboxPort  PersistencePort  MemoryPort │ │ │
│  │  │  ModelRuntimePort  SystemResourceManagerPort                │ │ │
│  │  │  KnowledgePort (stub, Phase 2)                              │ │ │
│  │  └──────┬──────────────┬──────────────┬──────────────┬──────────┘ │ │
│  │         │              │              │              │              │ │
│  │   ┌─────▼────┐  ┌──────▼─────┐ ┌─────▼──────┐ ┌────▼─────┐ ┌────▼──┐│ │
│  │   │ DSH      │  │ Hermes     │ │ Model      │ │ Resource │ │Storage││ │
│  │   │ Port     │  │ Port       │ │ Runtime    │ │ Manager  │ │SQLite+││ │
│  │   │ STUB     │  │ STUB       │ │ Port STUB  │ │ Port STUB│ │ JSONL ││ │
│  │   │ (Phase 2:│  │ (Phase 2:  │ │ (Phase 2:  │ │(Phase 2: │ │ REAL  ││ │
│  │   │ Cordis)  │  │  Python)   │ │  adapters) │ │  probes) │ │ Phase1││ │
│  │   └──────────┘  └────────────┘ └────────────┘ └────────┘ └───────┘│ │
│  │                                                                    │ │
│  │  ConfigService • SessionCoordinator • AuditLogger                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Data dirs: %APPDATA%\Sovara\  • Logs: %APPDATA%\Sovara\logs\         │
│  Models: %APPDATA%\Sovara\models\  (Phase 2, on-demand)  • No network │
└─────────────────────────────────────────────────────────────────────────┘
```

**Validated combination:** The prompt's sketch (`App → Backend → Core → {DSH,Hermes,Model,Tools,Memory,RAG,Storage}`) is correct in intent but hides the ownership rule. Corrected: **Core is our port layer.** DSH and Hermes are **adapters behind `LlmPort/ToolPort/PersistencePort`**, not parents of Core. Model Runtime is a runtime-agnostic sidecar family, not a single hard-coded binary. Resource management is a first-class seam alongside models — essential on GPU workstations. **Phase 1 proves SOVARA's architecture with stubs; DSH/Hermes and model runtimes are not executed, only their contracts are preserved** so replacement stays a one-adapter swap (`packages/core/agent-loop/src/index.ts:359` `AgentLoop` is swappable; `hermes-agent run_agent.py:211` `AIAgent` is a facade of mixins — both were built to be replaced, but neither runs in Phase 1).

---

## 2. Component Boundaries (ours vs theirs)

| Component | Owns (Phase 1) | Lives behind | Reused how |
|-----------|------|--------------|------------|
| **AppShell + Renderer** | Window chrome, routing, theme, a11y, typed view state | — | New. Inspired by Hermes TUI/desktop patterns, not cloned. |
| **Main** | `BrowserWindow` lifecycle, `app.getPath('userData')`, startup ordering, crash/relaunch | — | Electron hardening checklist (`electron-development` skill). |
| **AppBackend** | Orchestrates ports, exposes typed IPC handlers, never exposes `fs`/`child_process` raw | — | New singleton. Validates every IPC payload with `zod`. **Phase 1: owns ports backed by stubs — no Cordis context is created.** |
| **PersistencePort** | `SessionStore` contract (`append`, `snapshotEvents`, `open/stat/list`, `flush`) | DSH `SessionPersistence` + `Session` event-sourcing shape | **Real in Phase 1** — the only Core port with a full implementation (SQLite+JSONL). Keeps `SessionEvent{seq,time,type,data,surfaceOp}` invariant (`packages/core/session/src/types.ts`) and `foldSurface→deriveMessages()` semantics so transcripts stay auditable. No Cordis import. |
| **LlmPort** | `LlmPort.stream(request): AsyncIterable<StreamChunk>` + `resolveModel` | DSH `LlmAdapter.stream` (`packages/llm/llm/src/types.ts`) | **Phase 1: InMemory stub** returning `unavailable` or canned streams. DSH's `prepareCall` generation-bound `PreparedLlmCall` stays inside the *future* DSH adapter, not in Phase 1 code. |
| **ToolPort** | `ToolRegistry` (register, list, dispatch) + `ToolDefinition` (schema+execute, no Cordis ctx) | DSH `tools/*` waterfall pipeline | **Phase 1: stub registry** (in-memory array). The `pre→guards→approval→execute→post→result` waterfall (`docs/tool-execution-pipeline.md:1`) is a *future* adapter internal, not a Phase 1 import. |
| **SandboxPort** | `exec(argv, cwd, signal): Result` | DSH `ctx.sandbox` (bwrap/Landlock/Seatbelt) + Hermes `tools/environments/*` | **Phase 1: allow-but-audit stub** — logs `argv` and returns `not-executed`. Future sidecar is not a dependency. |
| **Hermes Port** | Long-lived memory/skill/delegation contracts | `run_agent.py` `AIAgent` + `hermes_state.py:327` `SessionDB` | **Phase 1: stub.** No Python spawned, no `hermes-agent` import. A typed `HermesPort` interface exists; its single Phase 1 implementation is `HermesStubAdapter` (`unavailable`). Future `HermesChildAdapter` (Python stdio JSONL, `AIAgent` translate) is Phase 2 and lives only behind the port. |
| **DSH Port** | Cordis composition, turn/step loop, approval, compaction, scope | `packages/core/agent-loop/src/agent.ts` `ReactLoopAgent` + `packages/boot/app-boot` | **Phase 1: stub.** No Cordis `ctx`, no `CordisBoundary`, no `dsh-*` packages vendored. The `DshPort` interface is defined; `DshStubAdapter` implements it as `unavailable`. Future `DshCordisAdapter` (Cordis context inside AppBackend) is Phase 2. |
| **ModelRuntimePort** | **Runtime-agnostic** local inference contract (see §6) | Any local runtime exposing OpenAI-compatible HTTP or native bindings (llama.cpp / Ollama / LM Studio / vLLM / other) | **Phase 1: stub.** `ModelRuntimeStubAdapter` lists configured models from `config.json` only, never probes disks or spawns. Future adapters (`LlamaCppAdapter`, `OllamaAdapter`, `LmStudioAdapter`, `VllmAdapter`) all implement the *same* `ModelRuntimePort`. |
| **SystemResourceManagerPort** | CPU/RAM/GPU/VRAM/disk + running instances + limits (see §7) | OS probes + model runtime telemetry | **Phase 1: contract + stub.** `SystemResourceStub` returns static `unknown` or best-effort `os.cpus()/os.totalmem()` mock. No native GPU probe in Phase 1. |
| **Storage** | SQLite metadata + JSONL event log | Both systems' WAL SQLite patterns | **Real** (see §8). |

**Dependency inversion — Phase 1 rule:** `AppBackend` depends on `LlmPort` / `HermesPort` / `DshPort` / `ModelRuntimePort` / `SystemResourceManagerPort` interfaces (`shared/types/ports.ts`), never on a concrete `DshCordisAdapter` or `HermesChildAdapter`. Concretes (even stubs) are registered at composition root (`main/backendComposition.ts`). Renderer and shared types never mention Cordis or `run_agent`.

---

## 3. Process Boundaries

```
Electron Main (PID 1, Node) — Phase 1 only 3 processes exist
 ├─ Renderer (Chromium, sandbox:true, nodeIntegration:false, contextIsolation:true)
 ├─ Preload (contextBridge, whitelisted channels only)
 └─ AppBackend (in Main, isolated module; owns stub ports — no Cordis ctx yet)

Phase 2 (not spawned in Phase 1, shown dashed):
 ┊  ├─ Hermes Child (Python, stdio, spawned by AppBackend, killed on app quit)
 ┊  ├─ Model Sidecar — any runtime (llama.cpp / ollama / lmstudio / vLLM), one per loaded model, health-checked
 ┊  └─ Optional Utility process (if model/TTS work risks renderer jank — ponytail split)
```

* Why not `Utility` process yet: **YAGNI.** One AppBackend in Main is the smallest working topology (`desktop-app` skill). An extra `Utility` for crash isolation is a Phase 2 split (`ponytail: single-process backend, split to Utility when model/TTS work risks renderer jank`).
* Single-instance lock: `app.requestSingleInstanceLock()` — second launch focuses existing window, no port conflict.
* Graceful shutdown (Phase 1): `app.on('before-quit')` → `AppBackend.dispose()` → `SessionStore.flush()` → `app.quit()`. Phase 2 extends the chain to `HermesChild.kill('SIGTERM', 3s→SIGKILL)` → `ModelSidecar.stop()`.

---

## 4. DeepSeek Harness Integration Boundary — Interface-Only in Phase 1

> **Phase 1 rule (correction #1): we do NOT embed or run Cordis/DSH.** No `vendor/cordis`, no `CordisBoundary`, no `dsh-*` npm packages, no `cordis.yml`/`cordis.patch.yml` at runtime. The boundary is a **typed contract** we preserve so the future adapter is a drop-in.

**Contract we preserve (types, not runtime):**
- Our `shared/types/session.ts` defines `SessionEvent{seq,time,type,data,surfaceOp?,sourceEventSeqs?}` and `SurfaceOp = 'append'|{op:'replace',start,end}` compatible with DSH's `SessionEventMap` extensibility (`declare module '@deepseek-ai/dsh-session/types'`), but defined locally, not imported. Our `foldSurface` + `deriveMessages()` keep the same semantics (`packages/core/session/src/surface.ts` `foldSurface` + `packages/core/agent-loop/src/agent.ts:258` `turn()` invariants) so transcript reconstruction stays deterministic even before DSH ships.
- We **do not** mount DSH's `StreamChunk` `block-start|delta|block-end|usage|finish` protocol directly in Phase 1; our `LlmPort` stream carries a minimal `TextChunk | ToolCallChunk` union that maps losslessly to the future `BlockAssembler` (`packages/llm/llm/src/assembler.ts`) when the adapter lands.

**What the future DSH adapter will reuse (Phase 2, not Phase 1):**
- Event-sourcing log + `Session.surface`/`deriveMessages()` + `request/header` canonicalization (`request-header.ts:headerEquals`) for audit.
- Tool pipeline waterfalls (`tools/pre-execute → guards → approval → tools/execute → post-execute → tools/result` with `next()` `docs/cordis-primer.md:30`) kept as adapter internals.
- Persistence seam shape (`SessionPersistence{create/open/stat/list/export}` + `SessionHandle{read/append/close}`) — we already match it; the adapter will map to our JSONL layout (§8).

**What Phase 1 explicitly does NOT do:**
- Never `import {Context} from '@deepseek-ai/cordis'` in any shipped file.
- Never expose `cordis.yml` to the user (profiles stay as our `SessionStore` rows).
- Never mount `dsh-web-app` bundle; we have our own Renderer.
- No `pnpm --filter @deepseek-ai/dsh-*` in Phase 1 — nothing to vendor.

**How we prove the seam without the runtime:** All Phase 1 `LlmPort`/`ToolPort`/`PersistencePort` consumers (`main/ipc/handlers.ts`, Renderer stores) import only `shared/types/ports.ts`. A composition test `tests/ports.contract.test.ts` asserts every stub satisfies the interface and that swapping to a mock DSH-shaped adapter passes without caller changes. This is the "prove SOVARA's architecture, not DSH integration" gate.

---

## 5. Hermes Integration Boundary — Interface-Only in Phase 1

> **Phase 1 rule (correction #1): we do NOT launch Hermes.** No `python run_agent.py`, no `hermes_state.py` import, no `tools/registry.py` scan. Hermes is a **typed port stub**; its rich loop is studied, not executed.

**Contract we preserve (based on traced Hermes source, not a Python binding):**
- Loop invariant: only sanctioned cache break is compression (`agent/AGENTS.md:71`); we adopt as `LlmPort` doc: `system` frozen per session until explicit `invalidateSystemPrompt()`.
- Durability invariant: persist-before-execute (`agent/turn_tool_round.py:52`) → our `PersistencePort.flush()` contract notes the future tool adapter MUST NOT report success without a flushed `tool/call` row.
- Registry shape: `toolset` grouping (`toolsets.py:TOOLSETS`) + `get_definitions()` discovery inspires our `ToolPort.list()` grouping, but Phase 1 ToolPort is a plain `register(name, toolset, schema, handler)` in-memory map — no AST scan (`tools/registry.py:86`) until Phase 2.

**What the future Hermes adapter will reuse (Phase 2, not Phase 1):**
- `AIAgent(60+ kwargs)` (`run_agent.py:233`) only inside `HermesChildAdapter.spawn()` as a stdio child, translating `SessionEvent[]` ↔ OpenAI `messages[]`, bounding errors to `_MAX_TOOL_ERROR_CHARS=2048` (`tools/registry.py:25`).
- Memory/context engines (`agent/memory_provider.py ABC`, `agent/curator.py`) as plugins behind the same port, not AppBackend globals.

**What Phase 1 explicitly does NOT do:**
- Never `import run_agent` or `hermes_state` or `tools.registry`. No `~/.hermes` hardcoding (`get_hermes_home()` rule `AGENTS.md:267` → we use `app.getPath('userData')`); no `HERMES_HOME` env inheritance.
- No gateway platforms, cron, `gateway/run.py` two-guard logic (studied for later `SessionCoordinator` design, not copied).

**Replacement guarantee:** If Hermes is removed or never integrated, `HermesStubAdapter` is deleted and `DshCordisAdapter` + any `ModelRuntimePort` adapter cover the same `LlmPort`/`ToolPort`. All callers see the same port.

---

## 6. Model Runtime Boundary — Runtime-Agnostic Port

> **Correction #2: no hard-coded llama.cpp assumption.** The core depends only on `ModelRuntimePort`. Llama.cpp is one of several future adapters, not the implementation.

Phase 1: **no model execution, no sidecar spawn, no GGUF probing.** The boundary exists as interface + stub/mock.

```ts
// shared/types/ports.ts — the ONLY model-runtime contract the app imports
interface LocalModel {
  id: string              // content hash or path-derived stable id
  displayName: string
  path?: string           // %APPDATA%\Sovara\models\<file> when managed by us
  source: 'sovara' | 'ollama' | 'lmstudio' | 'vllm' | 'custom' // runtime-agnostic discovery tag
  format: 'gguf' | 'safetensors' | 'unknown'
  params?: string         // "7B", "13B"
  quant?: string          // "Q4_K_M", "Q5_K_M", etc. when known
  discoveredAt?: number
}
interface ModelInstance {
  id: string              // runtime instance id
  modelId: string
  runtimeId: string       // which runtime adapter loaded it: 'llama.cpp'|'ollama'|'lmstudio'|'vllm'|...
  status: 'loaded'|'loading'|'unloaded'|'error'
  ctxLen: number
  port?: number           // if HTTP island
  pid?: number
  startedAt?: number
}
interface ModelRuntimePort {
  // Discovery — Phase 1 stub returns only rows from config.json / model_library table, never scans disks/services
  listLocalModels(): Promise<LocalModel[]>
  // Lifecycle — Phase 1 stub returns {status:'error', reason:'unavailable-in-Phase1'}; Phase 2 delegates to adapter
  load(modelId: string, opts:{ ctxLen?:number; gpu?: 'auto'|'cpu'|number; runtimeId?:string }): Promise<ModelInstance>
  unload(instanceId: string): Promise<void>
  health(instanceId: string): Promise<{ ok:boolean; vramUsedMB?:number; error?:string }>
  baseUrl(instanceId: string): string // http://127.0.0.1:<port>/v1  (or throws if not HTTP runtime)
  listInstances(): Promise<ModelInstance[]>
  // Discovery probe for a specific runtime — Phase 1 stub returns {available:false}
  probeRuntime(runtimeId: string): Promise<{ available:boolean; version?:string; path?:string }>
}
```

* **Adapter family (Phase 2, behind the same port, none in Phase 1):**
  `LlamaCppAdapter` (native sidecar), `OllamaAdapter` (wraps `ollama list/show` + HTTP `/v1`), `LmStudioAdapter` (wraps LM Studio local server detection), `VllmAdapter`, `CustomOpenAICompatibleAdapter` (user-supplied `baseUrl`). Each verifies its own prompt template (ChatML vs Llama-3 Inst, etc.) — never guessed.
* **Discovery rule (Phase 2 spec, not implemented):** Each adapter probes only its own scope: filesystem paths it owns (`%APPDATA%\Sovara\models` for LlamaCpp), registry/HTTP probes for Ollama (`127.0.0.1:11434`), LM Studio (`127.0.0.1:1234`), etc. Core aggregates by `LocalModel.source`. Results surfaced identically regardless of runtime — UI never branches on `runtimeId`.
* **VRAM/math note:** Sizing (`params * bpp/8 + KV_ctx`) stays in adapter helpers (`local-llm-expert` skill), not in core. Default quant is adapter-chosen, not core-mandated.
* **Sovereignty:** no download without explicit `download(url)` (future method gated by `settings.network.allowModelDownload === true`). No auto-update, no telemetry.

*Why this abstraction matters:* Corporate workstations ship heterogeneous runtimes (Ollama for devs, LM Studio for testers, vLLM on shared GPU boxes). Hard-coding one runtime would lock the workbench to one IT image — the port avoids that.

---

## 7. System Resource Management — First-Class Seam

> **Correction #3:** Resource management is a first-class architectural seam, not an afterthought. Corporate GPU workstations must not OOM because two models were loaded blindly.

Phase 1: **contract + stub only.** No native probes, no `nvml`, no watcher loop. We define the port so ModelRuntime and UI can be pressure-aware from day one.

```ts
// shared/types/ports.ts — next to ModelRuntimePort
interface SystemResources {
  cpu: { logicalCores:number; loadAvg1:number }       // loadAvg from os.loadavg() or stub
  ram: { totalMB:number; freeMB:number; usedByAppMB:number }
  gpu: { available:boolean; name?:string; driverVersion?:string } // one entry Phase 1, multi-GPU Phase 2
  vram: { totalMB?:number; freeMB?:number; usedByModelsMB?:number } // unknown until Phase 2 GPU probe
  disk: { path:string; totalMB:number; freeMB:number }  // Sovara data dir volume
  models: { instances: ModelInstance[]; totalVramUsedMB?:number } // derived from ModelRuntimePort.listInstances()+health()
  limits: { maxConcurrentModels:number; maxVramBudgetMB?:number; maxRamBudgetMB?:number } // from settings
}
interface ResourcePressure { level:'ok'|'warn'|'critical'; reason?:string; blocking?:boolean }
interface SystemResourceManagerPort {
  // Snapshot — Phase 1 stub returns static best-effort from Node `os` only; GPU/VRAM = unknown
  getSnapshot(): Promise<SystemResources>
  // Advisory check before a load — Phase 1 stub always returns {level:'ok'} so callers keep flowing
  checkBeforeLoad(model: LocalModel, opts:{ctxLen?:number}): Promise<ResourcePressure>
  // Subscribe to future periodic polls — Phase 1 stub returns no-op disposer
  watch?(cb:(snap:SystemResources)=>void, intervalMs?:number): () => void
  // Limits the user owns — backed by ConfigService
  getLimits(): Promise<SystemResources['limits']>
  setLimits(partial: Partial<SystemResources['limits']>): Promise<void>
}
```

* **Where it lives:** `main/backend/ports/SystemResourceStub.ts` (Phase 1) + future `main/backend/ports/SystemResourceManager.ts` + `main/backend/probes/*` (`GpuProbe`, `VramProbe`, `DiskProbe` using `app.getGPUInfo('complete')`, `os.*`, and runtime `health()` aggregation). It does NOT duplicate `ModelRuntimePort` — it *consumes* `ModelRuntimePort.listInstances()/health()` to account for `usedByModelsMB`.
* **Who reads it:** `ModelRuntimePort.load()` calls `checkBeforeLoad()` first and returns `error:'resource-pressure'` if `blocking:true`; Renderer `features/models` uses `getSnapshot()` to show RAM/VRAM bars; future Scheduler uses `watch()` to pause background jobs.
* **Sovereignty/perf:** No daemon, no interval timer in Phase 1. Phase 2 polling is main-only, 5s default, backoff when window hidden (`powerMonitor` + `BrowserWindow.isVisible()`), never in Renderer.
* **Limits source:** `%APPDATA%\Sovara\config.json` via `ConfigService` (`maxConcurrentModels:1` default on Phase 1, `ponytail: raise to 2 when enough GPU machines prove stable`).

---

## 8. Storage Architecture — Hybrid SQLite + Append-Only JSONL

**Decision:** **Keep the hybrid design from the brief; it matches both parents.** DSH already is hybrid (metadata tables + `session.vN.jsonl[.zstd]` per `docs/architecture.md:108` `SessionPersistenceNotFoundError` + `packages/session/session-persistence-jsonl/src/index.ts`); Hermes is SQLite-heavy with WAL + FTS (`hermes_state_common.py:269` `SCHEMA_SQL`, `hermes_state.py:333` `_WRITE_PATIENCE_S=20s`). Our design unifies without inventing a third format.

```
%APPDATA%\Sovara\
 ├─ sovara.db                  # SQLite WAL, single file (better-sqlite3, synchronous=NORMAL)
 ├─ sessions\<sessionId>\      # one dir per session
 │   ├─ events.v1.jsonl        # append-only, one JSON per line = one SessionEvent (frozen)
 │   │                        # seq = lines length; never rewrite, never delete committed generations
 │   └─ attachments\<hash>     # content-addressed blobs for file-upload tool (Phase 2)
 ├─ models\                   # managed model files when ModelRuntimePort manages them (Phase 2)
 ├─ logs\                     # rolling logs, never JSONL event log
 └─ config.json               # validated user prefs (not secrets)
```

**SQLite (`sovara.db`) — indexed, queryable:**

| Table | Why SQLite |
|-------|------------|
| `sessions` | `id` PK, `title`, `createdAt`, `updatedAt`, `inheritedFrom`, `seedLen`, `modelId`, `preset`, `pinned`, `archived`, `turnCount`, `lastPreview` — list/sort/filter need index; `idx_sessions_effective_activity` pattern borrowed from Hermes `DEFERRED_INDEX_SQL`. |
| `session_indexes` | `sessionId, seq` → file offset (optional after 100k line, `ponytail: scan JSONL until >50k events then add offset index`). |
| `model_library` | `modelId, path, source, params, quant, ctxLen, discoveredAt` — for Models page (runtime-agnostic; see §6). |
| `resource_snapshots` | `ts, cpuLoad, ramFreeMb, gpuName, vramTotalMb, vramFreeMb` — ring buffer (100 rows, Phase 2) for audit sparkline; Phase 1 table not created. |
| `app_meta` | `key TEXT PK, value TEXT` — `SCHEMA_VERSION`, `installId`, `lastRunVersion`. |

No `messages` table in SQLite — reconstruction is `foldSurface(events.jsonl)` → `deriveMessages()` (Harness semantics `packages/core/session/src/surface.ts`). Avoids double-write drift that Hermes mitigates with triggers (`FTS_SQL` `WHEN` guards). FTS is Phase 2 (`messages_fts` external-content `content='sessions/messages'`) — YAGNI until search ships.

**JSONL (`events.v1.jsonl`) — source of truth:**

* Each line = `SessionEvent{seq,time,type,data,surfaceOp?, sourceEventSeqs?, envelope:{ignorable?}}` lossless JSON. Validation `isJsonValue` at `PersistencePort.append` (throws, never persists bad event — same rule as DSH `Session.append` `docs/subsystems/session.md:524`). `seq = log.length` contiguity enforced. No `sparse array`, `BigInt`, `undefined`, `NaN`, `Date` class. One iterative validate-copy pass.
* File kept under handle with `open(..., 'a')` + `fsync` on `session/flush` checkpoint (`session/flush` concept from DSH `agent-loop/src/index.ts:740` `appendUnstoredSuffix`). Crash before flush = no durable attempt stream (`docs/architecture.md:107` hard-loss note) — acceptable; never fabricate a log from live `agent/assistant-stream`.
* Versioning: adjacent migrations `v1→v2` as file sidecar `events.v1.jsonl` + `events.v2.jsonl` plus `header.version` in `sovara.db:sessions.version`; readers refuse future version unless `ignorable:true` (`docs/subsystems/session.md:241` SessionEvent envelope rule). Never move/overwrite/delete committed generations.

**Reconstruction:** `foldSurface` builds `SessionSurface{nodes, replaceGeneration}` from `surfaceOp`; `deriveMessages()` walks surface nodes — transcript is ordered derived surface, not raw tail (same as DSH Anm. `isAppendSurfaceEvent` distinction). Fork/resume: `SessionPreparation.create(sessions.prepare(id,{seed, meta, inheritedEventCount}))` pattern (`packages/core/agent-loop/src/index.ts:753`).

**Why hybrid wins here:** SQLite for fast `list` (no per-session file scan), indexes, relations, config metadata; JSONL for tamper-evident append log, O(1) append, zlib-compress-friendly, `git diff`-readable, no migration hell for large blobs (tool outputs). Pure SQLite would need to `UPDATE json` compaction; pure JSONL would rescan every file to list.

---

## 9. IPC Architecture — Secure, Typed, Auditable

**Security contract (from `electron-development` skill Production Checklist — all mandatory):**

```ts
// main/window.ts
new BrowserWindow({
  width: 1280, height: 800, minWidth: 980, minHeight: 640,
  titleBarStyle: 'hiddenInset', // Windows: native chrome in Phase 1 (no custom chrome complexity)
  backgroundColor: '#0f1115',
  webPreferences: {
    preload: join(__dirname, '../preload/preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false,
  }
})
// CSP header on every window
session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: {
  ...d.responseHeaders,
  'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:*"]
}}))
// Navigation hijack block
win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://') && !url.startsWith('http://localhost:5173')) e.preventDefault() })
win.webContents.setWindowOpenHandler(({url}) => {
  const u = new URL(url); const allowed = new Set(['github.com']); // allowlist only
  if (u.protocol==='https:' && allowed.has(u.hostname)) shell.openExternal(u.toString());
  return {action:'deny'}
})
app.on('web-contents-created', (_, c) => c.on('will-attach-webview', e => e.preventDefault()))
```

**Preload — whitelisted contextBridge (`shared/ipc/channels.ts` is single source):**

```ts
// shared/ipc/channels.ts
export const IPC_CHANNELS = {
  'app:getInfo': { type: 'invoke' },
  'app:getSystem': { type: 'invoke' },
  'system:getResources': { type: 'invoke' }, // new: SystemResourceManagerPort snapshot
  'sessions:list': { type: 'invoke' }, 'sessions:create': { type: 'invoke' }, 'sessions:get': { type: 'invoke' },
  'chat:send': { type: 'invoke' }, 'chat:cancel': { type: 'invoke' },
  'models:listLocal': { type: 'invoke' }, 'models:load': { type: 'invoke' }, 'models:probeRuntime': { type:'invoke' },
  'settings:get': { type: 'invoke' }, 'settings:set': { type: 'invoke' },
  'events:session': { type: 'on' }, // main→renderer push (session/event)
  'events:resources': { type: 'on' }, // main→renderer push (resource snapshot, Phase 2)
} as const

// preload/preload.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/channels'
const ALLOWED_INVOKE = Object.entries(IPC_CHANNELS).filter(([,v])=>v.type==='invoke').map(([k])=>k)
contextBridge.exposeInMainWorld('sovara', {
  invoke: (ch:string, ...a:unknown[]) => {
    if (!ALLOWED_INVOKE.includes(ch)) return Promise.reject(new Error(`blocked:${ch}`))
    return ipcRenderer.invoke(ch, ...a)
  },
  on: (ch:string, cb:(...a:unknown[])=>void) => {
    if (IPC_CHANNELS[ch as keyof typeof IPC_CHANNELS]?.type!=='on') return ()=>{}
    const l = (_:Electron.IpcRendererEvent, ...a:unknown[])=>cb(...a); ipcRenderer.on(ch, l); return ()=>ipcRenderer.removeListener(ch,l)
  }
})
declare global { interface Window { sovara: { invoke:(c:string,...a:unknown[])=>Promise<unknown>; on:(c:string,cb:(...a:unknown[])=>void)=>()=>void } } }
```

* Renderer never imports `fs`, `child_process`, `electron`. All calls `window.sovara.invoke('sessions:list', {cursor})` → `ipcMain.handle('sessions:list', validate(zSessionsList).handler)` in `main/ipc/handlers.ts`. Every handler validates with `zod` before touching a port.

**Event push:** AppBackend `session/event` emits to all `BrowserWindow` via `win.webContents.send('events:session', {sessionId, events})`. `events:resources` is Phase 2. Renderer folds into local Zustand store keyed by `SessionId` (Branded `string & {__brand:'SessionId'}` from `util/brand`).

* No `ipcRenderer.sendSync`, no raw `ipcRenderer` exposure, no `remote`.

---

## 10. Security / Network Boundary — Sovereign-by-Default

* **Default = offline.** `app` never calls `fetch` to external hosts. `NSC` / firewall rule: document that the .exe makes **zero** outbound connections at rest (prove via `netstat -ano | findstr sovara` + CI `verify-no-network` test that fails if any `fetch('https://` exits the bundle).
* **Allowlisted network surface (explicit, toggle-gated, audited):**

| Feature | Where gated | Default | Audit log |
|---------|-------------|---------|-----------|
| Model download (any registry) | `settings.network.allowModelDownload` + per-download `allowExternalFetch()` | `false` | `settings/change` event `source:'user'` |
| MCP HTTP transport | Per-MCP `transport:'http'` entry + `allowNetworkForMcp` | disabled until Phase 3 | `mcp/enabled` event |
| Update check | `settings.network.allowUpdateCheck` | `false` (Phase 1: no check) | `app/update-check` |
| Resource probe HTTP (Ollama/LM Studio probe) | `system:probeRuntime` via `HttpClient` with `allow:'runtimeProbe'` | local-only `127.0.0.1` allowlist; external probe still gated by `allowModelDownload` | `system/probe` event |

* Isolation primitive: `network/HttpClient` module is the **only** place that may call `fetch`/`net.request`. All feature code imports `httpClient.get(url, {allow: 'modelDownload'|'runtimeProbe'|'mcp'})` which throws if the corresponding `settings.network.*` flag is false (or, for `runtimeProbe`, if host is not `127.0.0.1`/`::1`/`localhost`). CI gate `verify-no-bare-fetch` rejects `fetch(` outside that file (same pattern as Hermes `verify-no-bare-dispatcher` `AGENTS.md:104`).
* No telemetry, no analytics SDK, no `electron-updater` auto-download in Phase 1 (sovereign installer is full .exe, not delta). When updates ship, they are manual `sovara-setup-1.2.3.exe` side-by-side, verified via SHA256 shown in Settings.
* Filesystem: all paths resolved under `app.getPath('userData')` or explicit user-picked dir via `dialog:showOpenDialog`. No arbitrary `readFile` from renderer-supplied path — handler does `path.resolve(base, rel).startsWith(base) || throw 403`.
* Renderer sandbox `true` + `allowRunningInsecureContent:false` + strict CSP ensures injected HTML cannot escape to Node.

---

## 11. Logging / Audit Architecture

**Three log classes, one source of truth for audit:**

1. **Event log (audit-grade)** — `sessions/<id>/events.v1.jsonl` (above). Every model-visible fact lands here. Retrieval = `snapshotEvents(from, to)` (frozen deep-clone like `Session.snapshotEvents` `docs/subsystems/session.md:472`). UI "Session details" panel shows raw `SessionEvent` timeline for audit.
2. **App log (diagnostics)** — `%APPDATA%\Sovara\logs\app.log` (Winston, rolling 10×10MB, `logLevel:info`). Structured JSON per line: `{time, level, scope:'main|backend|ipc|models|resources|storage', sessionId?, msg, data?}`. Never contains full `events.v1.jsonl` dumps.
3. **Renderer log** — `console.log` → `window.sovara.invoke('log:renderer', entry)` batched, level-filtered; also written to `app.log` with `scope:renderer`.

* **Reconstructability check:** nightly `verify-audit` job replays `events.v1.jsonl → deriveMessages()` and compares to stored last turn's `request/header` snapshot; mismatch → `app.log` warning. Mirrors DSH runtime invariant `model-visible ⟺ logged` (`AGENTS.md:111`).
* Resource pressure events (`system/pressure:{level,reason}`) are diagnostics in `app.log` only, not session `events.v1.jsonl`, until a turn is blocked — then a single `system/resource-blocked` log row (Phase 2) is appended so audit can see why a load was refused.
* Secrets (if any) never hit logs (`hermes_agent model_tools.py` sanitization discipline + `hermes_logging.py` profile-aware sinks adopted as `AuditLogger.sanitize({redact:'token'})`).

---

## 12. Proposed Project Folder Structure

Single-repo, pnpm + electron-vite. ESM everywhere (`"type":"module"` like DSH `AGENTS.md:104`). `pnpm-workspace.yaml` owns only `apps/desktop`.

```
SOVARA/
├─ apps/
│  └─ desktop/                         # Electron app (only distributable)
│     ├─ package.json                  # @sovara/desktop, private, version 0.1.0
│     ├─ electron.vite.config.ts       # main + preload + renderer build targets (electron-vite)
│     ├─ tsconfig.json                 # strict:true, noImplicitAny:true, verbatimModuleSyntax
│     ├─ src/
│     │  ├─ main/                      # Node. Never imports renderer code.
│     │  │  ├─ index.ts                # app.whenReady → createWindow → startBackend
│     │  │  ├─ window.ts               # createMainWindow (security defaults, CSP, nav guards)
│     │  │  ├─ backendComposition.ts   # composition root: wires STUB ports → real/storage
│     │  │  ├─ ipc/
│     │  │  │  ├─ channels.ts  → re-export shared/ipc/channels (symlink via tsconfig paths)
│     │  │  │  └─ handlers.ts          # ipcMain.handle per channel, zod validation
│     │  │  ├─ backend/
│     │  │  │  ├─ AppBackend.ts        # class AppBackend { PersistencePort (REAL); LlmPort STUB; ... }
│     │  │  │  └─ ports/
│     │  │  │     ├─ SystemResourceStub.ts         # getSnapshot() → os.* mock; checkBeforeLoad→ok
│     │  │  │     ├─ ModelRuntimeStub.ts           # listLocalModels from config only
│     │  │  │     ├─ LlmStubAdapter.ts
│     │  │  │     ├─ ToolStubAdapter.ts
│     │  │  │     ├─ DshStubAdapter.ts             # no Cordis
│     │  │  │     ├─ HermesStubAdapter.ts          # no Python
│     │  │  │     └─ SqlitePersistenceAdapter.ts   # REAL: better-sqlite3 + JSONL
│     │  │  │     # Phase 2 adapters live alongside: CordisBoundary.ts, HermesChildAdapter.ts,
│     │  │  │     # LlamaCppAdapter.ts, OllamaAdapter.ts, LmStudioAdapter.ts, SystemResourceManager.ts
│     │  │  ├─ storage/
│     │  │  │  ├─ db.ts               # init better-sqlite3, WAL, SCHEMA_VERSION, prepare()
│     │  │  │  └─ paths.ts             # all app.getPath('userData') roots
│     │  │  ├─ config/
│     │  │  │  ├─ ConfigService.ts     # zod schema, file watch, ipc notify
│     │  │  │  └─ schema.ts
│     │  │  ├─ network/
│     │  │  │  └─ HttpClient.ts        # ONLY place allowed to call fetch; allow:'runtimeProbe'|...
│     │  │  └─ logging/
│     │  │     └─ Logger.ts            # winston rolling
│     │  ├─ preload/
│     │  │  └─ preload.ts              # contextBridge.exposeInMainWorld('sovara', …)
│     │  ├─ renderer/
│     │  │  ├─ index.html
│     │  │  ├─ main.tsx                # ReactDOM.createRoot, Router, ThemeProvider
│     │  │  ├─ app/
│     │  │  │  ├─ App.tsx              # <Shell><Routes…>
│     │  │  │  ├─ Shell.tsx            # sidebar + header + main workspace
│     │  │  │  ├─ routes.tsx
│     │  │  │  └─ theme/
│     │  │  │     ├─ tokens.ts         # CSS vars, no Tailwind config fork
│     │  │  │     └─ ThemeProvider.tsx
│     │  │  ├─ features/
│     │  │  │  ├─ chat/                # Chat page + hooks (UI shell only in Phase 1)
│     │  │  │  ├─ sessions/            # SessionList placeholder
│     │  │  │  ├─ models/              # Models placeholder + SystemInfo/Resource bar (read-only)
│     │  │  │  ├─ agents/              # Agents placeholder
│     │  │  │  └─ settings/            # Settings placeholder
│     │  │  ├─ components/ui/          # Button, Input, Card, List, EmptyState (small, reusable)
│     │  │  ├─ stores/                 # Zustand: sessionStore, settingsStore, modelStore, resourceStore
│     │  │  └─ lib/
│     │  │     └─ ipc.ts               # typed window.sovara wrapper
│     │  └─ shared/                    # imported by main+preload+renderer (types only)
│     │     ├─ types/
│     │     │  ├─ branded.ts           # Branded<'SessionId'>, SessionId, ToolCallId
│     │     │  ├─ ports.ts             # LlmPort, ToolPort, PersistencePort, ModelRuntimePort, SystemResourceManagerPort
│     │     │  ├─ ipc.ts               # IpcRequest/IpcResponse mapped from IPC_CHANNELS
│     │     │  └─ session.ts           # SessionEvent, SurfaceOp, content block types (minimal)
│     │     ├─ ipc/
│     │     │  └─ channels.ts          # single source IPC_CHANNELS
│     │     └─ constants.ts            # channel names, limits, defaults (no magic constants elsewhere)
│     ├─ resources/
│     │  ├─ icon.ico / icon.png        # 1024 source, built pipeline resizes
│     │  └─ entitlements.*             # mac guard, unused Windows but kept
│     └─ tests/
│        ├─ ipc.contract.test.ts       # every channel has zod schema ↔ handler roundtrip
│        ├─ storage.unit.test.ts       # SQLite in :memory:, seq contiguity, WAL
│        └─ ports.contract.test.ts     # stub ports satisfy interface; swap to mock adapter passes
│  └─ vendor/                          # NOT created in Phase 1 — future Cordis copy if we vendor
├─ test/                               # reference checkouts (hermes-agent, deepseek-harness) — read-only, not shipped
├─ docs/
│  └─ ARCHITECTURE_PHASE1.md           # this file
├─ .editorconfig
└─ pnpm-workspace.yaml
```

**Why not `packages/` monorepo yet:** YAGNI. One app is one workspace. Adding `packages/core-*` before the core exists is scaffolding for later (`ponytail: monorepo when second app/package ships, then extract shared/`).

---

## 13. Technology Choices and Justification

| Choice | What | Why (with alternative rejected) |
|--------|------|----------------------------------|
| **Electron + electron-vite** | Shell, .exe | Corporate Windows fleet runs Electron (Hermes desktop `apps/desktop/` proves it). Gives `BrowserWindow` control, `app.getPath`, `dialog`, `powerSaveBlocker`, GPU query (`app.getGPUInfo`). Tauri Tier-2 is leaner (3MB) but forces Rust toolchain + reimplementation of Node-side `hermes_state` SQLite discipline and Cordis which is Node-native. `ponytail: revisit Tauri when .exe size >150MB regresses or security audit demands Rust sandbox`. |
| **Vite + React 18 + TypeScript strict** | Renderer | Hermes dashboard `web/` + Hermes desktop `apps/desktop/src/` are React nanostore patterns; DSH `packages/client` is React. Vite HMR fastest for `electron-vite` triple build (main/preload/renderer). Strict `noImplicitAny` + exhaustive `switch(kind)` `assertNever` like DSH. |
| **Tailwind CSS v4, CSS-first** | Styling | `tailwind-patterns` skill: `bg-white` not `var(--)` wrapper, container queries. Keeps component files small vs CSS modules sprawl. Alternatives (shadcn/mantine) pulled in too late — Phase 1 is industrial restrained, not component-gallery. |
| **Zustand stores** | State | `zustand-store-ts` skill pattern (`create<Store>()` + `middleware`). Nanostores pattern mirrors Hermes desktop `src/store` atoms (`hermes-agent/ui-tui`). Redux overkill for Phase 1 shell. |
| **better-sqlite3 + JSONL** | Storage | Hermes `hermes_state.py` synchronous `BEGIN IMMEDIATE` + jitter shows `better-sqlite3` survives Windows `SQLITE_BUSY`. Synchronous (fits Main, no promise queue) and WAL-capable. Drizzle/Prisma not needed for 5 tables. |
| **zod** | IPC validation, config schema | Both DSH (`packages/core/agent-loop/src/index.ts` `z.object` + `schemastery`) and Hermes (runtime checks + zod-style schemas) validate at boundary. `zod` is the smallest typed validation that covers IPC + config + tool param + `SystemResourceManagerPort` limits validation in one. |
| **Winston + electron-log pattern** | Logging | Rolling, level filter, multiple transports. Hermes `hermes_logging.py` profile-aware split `agent.log/errors.log/gateway.log` is the template we copy per `sessionId` filter. |
| **Vitest + Playwright (electron)** | Testing | Matches DSH `vitest.config.ts` + `tests/e2e/app.spec.ts` pattern from `electron-development` skill. Single runner for unit + E2E ` _electron as electron.launch`. |
| **electron-builder** | Packaging | Proven in Hermes `apps/desktop` and `electron-builder.yml` recipe. `asar:true, compression:maximum, artifactName:${productName}-${version}-${arch}.${ext}, nsis:{oneClick:false}` per skill. Code signing injected via `CSC_LINK` env, not repo. |

No extra data-fetching lib (SWR/React Query) in Phase 1 — `window.sovara.invoke` is the fetch (`ponytail: add React Query when polling or cache staleness appears`). No `node-gyp` GPU probe lib in Phase 1 — `os` + `app.getGPUInfo('complete')` suffice for stub.

---

## 14. Dependency Graph

```
renderer (React) ──uses──▶ shared/types/ports  (types only)
       │                   shared/ipc/channels
       │                        ▲
       │                        │ imports (type)
       │                        │
preload ──exposes──▶ window.sovara.invoke/on  (whitelisted)
       ▲                        │
       │                        │
  main/window.ts            main/ipc/handlers.ts ──validates(zod)──▶ AppBackend
       │                        │                                     ├─► PersistencePort → SqlitePersistenceAdapter (REAL, Phase 1)
       │                        │                                     ├─► LlmPort → LlmStubAdapter (Phase 1) → (Phase 2: DshCordisAdapter)
       │                        │                                     ├─► ToolPort → ToolStubAdapter
       │                        │                                     ├─► DshPort → DshStubAdapter
       │                        │                                     ├─► HermesPort → HermesStubAdapter
       │                        │                                     ├─► ModelRuntimePort → ModelRuntimeStub
       │                        │                                     ├─► SystemResourceManagerPort → SystemResourceStub
       │                        │                                     │     └─(Phase 2: SystemResourceManager ← probes ← ModelRuntimePort.health())
       │                        │                                     └─► ConfigService / Logger
       │                        │
shared/constants ────────────────┴─────────────────────────────────────┴───► never imports Electron or fs
```

Rules:
* No cycle: `shared/` has no deps on `main/` or `renderer/`. `main/` never imports `renderer/`. Future `CordisBoundary` will live inside `main/backend/ports/`, not `shared/`, so Phase 1 has no Cordis node at all.
* `AppBackend` owns lifetimes; handlers hold a weak ref to it.
* `SystemResourceManagerPort` *consumes* `ModelRuntimePort.listInstances()/health()` — it does not duplicate model accounting.

---

## 15. Future Extension Points (design now, build later)

| Extension | Point we keep open | Not built now |
|-----------|--------------------|---------------|
| DSH Cordis integration | `DshPort` + `LlmPort`/`ToolPort` contracts; `main/backend/ports/` directory reserved | No Cordis `ctx`, no `vendor/` |
| Hermes capabilities | `HermesPort` stub; stdio child pattern reserved | No Python process |
| Any local runtime | `ModelRuntimePort` runtime-agnostic (llama.cpp / Ollama / LM Studio / vLLM / custom) | No adapters, no spawn, no GGUF scan |
| System probes | `SystemResourceManagerPort` contract + `resource_snapshots` table reserved | No `nvml`/`nvidia-smi`/`app.getGPUInfo` watcher |
| RAG / knowledge base | `KnowledgePort{ingest, query}` stub + `sessions/attachments/` dir exists; SQLite table `knowledge_docs` schema reserved | No ingest, no embeddings, no vector store |
| MCP | `ToolPort` already supports `register/unregister`; MCP = `McpToolAdapter implements ToolPort` that speaks SSE over `HttpClient` (allowlisted) | No `mcp_tool_*.py` equivalent, no discovery |
| Model download | `ModelRuntimePort.download()` signature + `settings.network.allow*` flags + `%APPDATA%\Sovara\models\` path | No fetch, no progress UI |
| Voice/TTS/STT | `AudioPort{transcribe, speak}` empty interface | No `edge-tts`, no whisper |
| Multi-window | `window.ts` factory already returns `createMainWindow(opts)`; `broadcastToAllWindows` helper stubbed | One window only |
| Plugin marketplace | `~/.sovara/plugins/` dir not created yet; Hermes pattern supports plugin as second child | None |
| Cloud sync | `PersistencePort.export(sessionId)` returns `events.v1.jsonl` + SQLite row — sync is a separate `SyncAdapter` later | Local only |
| Auto-update | `electron-builder` publish config commented out; `appUpdater` not imported | Manual full installer |

All points are interface-shaped, not code-shaped (no abstract factories for single impls).

---

## 16. What We Deliberately Are NOT Building Yet

* No Cordis import, no `ReactLoopAgent` wiring, no `turn/start→step/end` live execution — Chat page is a typed UI shell with mocked `ChatStore`. DSH stays in `test/` as reference.
* No Hermes Python process, no `SessionDB` WAL/FTS copy — `HermesStubAdapter` returns `unavailable` for every call.
* No model sidecar of any kind (no llama.cpp, no Ollama probe, no GGUF quant selection, no GPU VRAM math beyond `os.totalmem()`). `ModelRuntimeStub` and `SystemResourceStub` are static mocks.
* No FTS / `messages_fts` / trigram / CJK indexes (`hermes_state_common.py:543` rebuild logic) — SQLite `LIKE` only until search ships.
* No file-upload handling, no `FileBlock` projection, no `ImageAttachmentAccess` path resolution (`docs/subsystems/llm-streaming.md:36`).
* No sandbox mounts / bwrap / Landlock — `SandboxPort` is `allowAll` passthrough with audit log.
* No `Monaco` / `xterm` terminal widget.
* No second profile, no `conversation_generations` table, no multiplex authz mixin.
* No hosted auth, no cloud endpoints, no telemetry, no `autoUpdater.checkForUpdates()`.
* No `resource_snapshots` table creation — reserved but not migrated in Phase 1 (`SystemResourceManagerPort` stub needs no table).
* No monorepo `packages/` split — that extraction is Phase 2 when a second app appears.

**Why this is the right cut:** Ponytail ladder rung 1 (YAGNI) applied to each: shipping any of these now is speculative need with no Phase 1 consumer. Adding them later is a new adapter or a new `features/<x>/` folder, zero rewrite of the shell. **Crucially, Phase 1 still proves every sovereign seam exists as a typed contract** so later swaps are one-file changes.

---

## Phase 1 Implementation Plan — 6 Small Commits (post-approval)

> Steps mirror `desktop-app` PDCA checklist phases 1/3/5/6/7/9. Each commit is reviewable alone and leaves the app buildable. **All commits respect the three corrections: stubs only, runtime-agnostic, resource contract only.**

**Commit 1 — Scaffolding (no UI):** triple build `electron.vite.config.ts`, `tsconfig.json` strict, `shared/{types,ipc}`, `resources/` icons, `pnpm install`, `npm run dev` boots blank window. No `better-sqlite3` yet — `pnpm` lock only.

**Commit 2 — Security shell:** `main/window.ts` with mandatory `contextIsolation/nodeIntegration/sandbox/webSecurity/CSP/will-navigate/windowOpen` guards, `preload/preload.ts` whitelisted `window.sovara`, `main/ipc/handlers.ts` with zod-validated `app:getInfo, app:getSystem, system:getResources(mock), settings:get/set, sessions:list/create/get` handlers backed by mock `AppBackend` (in-memory array, no SQLite yet). Verifies `SystemResourceStub` wiring.

**Commit 3 — AppBackend skeleton + SQLite (real) + stub ports:** `better-sqlite3` WAL, `paths.ts` `app.getPath('userData')/Sovara`, `db.ts` `SCHEMA_VERSION=1` with `sessions/app_meta/model_library` tables (no `resource_snapshots` yet), `SqlitePersistenceAdapter` writing `events.v1.jsonl` + `sessions` row, `SessionId` branded, `seq` contiguity invariant. Wire `LlmStubAdapter`/`ToolStubAdapter`/`DshStubAdapter`/`HermesStubAdapter`/`ModelRuntimeStub`/`SystemResourceStub` into `backendComposition.ts`. No Cordis, no Python.

**Commit 4 — Renderer shell + design system:** `Shell.tsx` (sidebar nav, window controls, status bar), `ThemeProvider` + `tokens.ts` (CSS vars, dark-only Phase 1, restrained industrial palette), 5 placeholder routes (`/chat`, `/sessions`, `/models`, `/agents`, `/settings`), `components/ui` (Button, Card, EmptyState), Zustand `sessionStore/settingsStore/modelStore/resourceStore` (resourceStore reads `system:getResources` stub).

**Commit 5 — Chat shell (UI only):** `features/chat` — message list rendering from `deriveMessages()` mock (TextBlock only, no tool), composer input, session switcher, keyboard nav + focus states (a11y 4.5:1, `ui-ux-pro-max` checklist). Backed by `ChatStore` mock that appends `user/message` locally via `sessions:create` JSONL, no LLM call.

**Commit 6 — Window polish + packaging smoke:** window bounds persist `store.set('windowBounds')`, single-instance lock, `before-quit` flush, `electron-builder.yml` `asar/maximum/nsis(oneClick:false)` + `npm run build:win` produces `.exe` on local, `vitest` unit + `playwright electron` smoke `app firstWindow title`.

Each commit runs `tsc --noEmit`, `vitest run`, `electron-builder --dir` as gate. No Phase 1 commit spawns a model runtime, Cordis ctx, or Python child — CI asserts with `verify-no-cordis-import` (no `from '@deepseek-ai/cordis'` outside `future/`) and `verify-no-python-spawn`.

---

## Major Risks / Tradeoffs

| Risk | Impact | Mitigation (where feasible) |
|------|--------|-----------------------------|
| **Better-sqlite3 native rebuild on Windows** — `invalid ELF` / ABI mismatch per `electron-development` diagnostics | App won't start after `npm install` | `pnpm rebuild`, `@electron/rebuild`, pin `better-sqlite3` + electron version; CI Matrix Windows runner proves it; fallback `ponytail: swap to sqlite3 pureJS if rebuild keeps failing` |
| **Native theme looks generic** | Industrial claim fails | `ui-ux-pro-max --design-system` already applied offline (restrained palette, 16px min body, 44px touch target, 150–300ms motion, slate-900 text). Avoid `desktop-app` guide's excessive rounded cards / gradients. |
| **Cordis learning curve deferred** — Phase 1 ships no Cordis, so team fluency risk moves to Phase 2 | Phase 2 integration slower if team hasn't read `docs/cordis-primer.md:30` | Document `docs/DSH_PRIMER.md` as reading list; `DshStubAdapter` doc-comment points to `turn()` waterfall `next()` semantics so future author knows the pitfall. |
| **Hermes Python bring-along deferred** — future bundling decision not made | If later chosen, installer bloat | Phase 1 proves we don't need it: `HermesStubAdapter` benchmark in Phase 2 decides `hermes --child-bridge` vs reimplementing `memory/skill` subset in Node, gated behind port. |
| **Runtime-agnostic ModelRuntimePort too abstract** — `probeRuntime`/`baseUrl` hide per-runtime quirks | Adapter leaks (Ollama `show` vs LM Studio file scan) | Each adapter owns quirks; port stays uniform. `provider`/`auxiliary:` resolution pattern from Hermes (`agent/AGENTS.md:86`) lives only inside adapters, not core. |
| **Resource stub too coarse** — Phase 1 `getSnapshot()` returns unknown VRAM, so UI bars are empty | Users see "—" for VRAM on models page | Stub explicitly documents `unknown` vs `0`; Models page renders "Detection available Phase 2" helper, not a misleading 0. `ponytail: don't fabricate VRAM from random driver call`. |
| **Offline sovereignty proof** — "auditable no-network" is never proven by UI | Compliance rejection | CI `verify-no-bare-fetch` + `verify-no-telemetry` scripts, `net.request` audit in `HttpClient.ts`, and manual Wireshark capture in release notes. `verify-no-cordis-import` added for Phase 1. |
| **File path handling (Windows slash vs POSIX)** | Log replay breaks on `/` vs `\` | Normalize with `path.posix` for log, `path.win32` for disk; store all log paths as posix, convert at I/O edge; test `windows_only` marked case (`hermes-agent AGENTS.md:351`). |

---

### Approval Gate — Updated

**DO NOT PROCEED** until sign-off on:
1. Electron (not Tauri) for Phase 1
2. SQLite+JSONL hybrid as specified (only `sovara.db` + `events.v1.jsonl` in Phase 1)
3. **Stub-only DSH/Hermes in Phase 1** — typed ports with `DshStubAdapter`/`HermesStubAdapter`, no Cordis ctx, no Python child, proven swappable by `ports.contract.test.ts`
4. **Runtime-agnostic `ModelRuntimePort`** — one port, N future adapters (llama.cpp / Ollama / LM Studio / vLLM), no hard-coded sidecar in Phase 1
5. **First-class `SystemResourceManagerPort`** — contract + stub in Phase 1 (`getSnapshot`/`checkBeforeLoad`), real probes deferred
6. Sovereign-by-default network boundary (no auto-download, no updater, local-only `HttpClient`)
7. Commit plan (6 stubs-only commits) and explicit non-scope (§16)

On approval: we begin Commit 1 exactly as planned, no scope expansion. The approval you just gave **remains valid as corrected** — no new approval needed unless you object to §6 or §7 specifics.
