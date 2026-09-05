# SOVARA — Sovereign Autonomous Reasoning & Action

On-premise, air-gapped, agentic AI workbench for confidential industrial work.
Based on SIH Problem Statement **SIH26117**: sovereign on-premise agentic AI
workbench using open-weight multimodal LLMs.

> **Phase 0 scope:** architecture & engineering foundation ONLY — interfaces,
> boundaries, configuration, and scaffolding. No assistant, RAG, model routing,
> agent loop, OCR, multimodal inference, document generation, or production
> auth yet. Those plug into the contracts defined here in later phases.

## Quick start (local, no cloud AI required)

Backend uses [`uv`](https://docs.astral.sh/uv/) — no `pip install`:

```sh
cd backend
uv sync --group dev     # first run only; creates .venv + lockfile
uv run pytest           # contract + boundary tests
uv run uvicorn sovara.main:app --host 127.0.0.1 --port 8000
```

Frontend (needs node 20+):

```sh
cd frontend
npm install
npm run dev             # :5173, proxies /api to backend :8000
```

Full local stack via Docker (self-hosted images only):

```sh
docker compose up --build
# backend  http://127.0.0.1:8000/api/v1/health
# frontend http://127.0.0.1:8080/
```

## Project structure

```text
SOVARA
├── backend/                 # FastAPI modular monolith (API + contracts)
│   ├── src/sovara/
│   │   ├── api/v1/routes/   # health, system, models, conversations, tasks,
│   │   │                    # tools, knowledge, artifacts, audit
│   │   ├── application/     # orchestration services (stubs in Phase 0)
│   │   ├── domain/          # STABLE contracts: models, agents, tools,
│   │   │                    # knowledge, artifacts, audit, errors
│   │   └── infrastructure/  # config, logging, security, network policy
│   └── tests/               # contract + boundary tests (run with uv)
├── frontend/                # Vite + React + TS boundary (status display only)
│   └── src/api/             # typed client — the only HTTP layer
├── docs/
│   ├── adr/                 # architecture decision records
│   └── api/OVERVIEW.md      # endpoint contract map
├── ARCHITECTURE.md          # boundaries, dependency direction, extension points
├── DEVELOPMENT.md           # setup, commands, testing, conventions
└── docker-compose.yml       # backend + frontend (local images only)
```

## Architecture at a glance

```
User → SOVARA UI → API Gateway (FastAPI) → Application/Orchestration
  → Agent Runtime (Planner/Executor/State/Memory/Tools — contracts only)
  → Model Gateway (Reasoning/Coding/Vision/Embedding — contracts only)
  → Knowledge (contracts only) → Tools (contracts only)
  → Security/Audit (abstractions + network-policy gate live in Phase 0)
```

Key rules: no coupling to one LLM/runtime; tools are plugins resolved by
name; the agent never gets arbitrary host access; external network is
deny-by-default through `NetworkPolicy.check_egress()`; single
workstation/server first.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/adr/](docs/adr/).

## Configuration

One source: environment variables prefixed `SOVARA_` (see
`backend/.env.example`). Sections: application, model, infrastructure,
security/network. Local-only network mode is the default.

## License

MIT — see [LICENSE](LICENSE).
