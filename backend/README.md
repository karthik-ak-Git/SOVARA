# SOVARA Backend (Phase 0)

FastAPI modular monolith — API boundary + stable domain contracts only.

No RAG, no model inference, no agent loop, no OCR, no document generation.
Those plug into `src/sovara/domain/` contracts in later phases.

## Layout

- `src/sovara/main.py` — app factory, middleware, error handlers
- `src/sovara/api/v1/routes/` — versioned route boundaries (placeholder responses)
- `src/sovara/domain/` — stable contracts: models, agents, tools, knowledge, artifacts, audit, errors
- `src/sovara/application/` — future orchestration services (stubs only in Phase 0)
- `src/sovara/infrastructure/` — config, logging, security, network policy
- `tests/` — contract + boundary tests

See root `ARCHITECTURE.md` and `DEVELOPMENT.md` for the full picture.
