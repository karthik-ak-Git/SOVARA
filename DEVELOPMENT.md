# SOVARA Development Guide

## Prerequisites

- Python 3.12+ with [`uv`](https://docs.astral.sh/uv/) (backend; **no `pip install`**)
- Node 20+ with npm (frontend)
- Docker 24+ with Compose v2 (optional, full stack)

## Backend (uv)

All commands run from `backend/`:

```sh
uv sync --group dev   # first run: create .venv, install deps, write uv.lock
uv run pytest         # full test suite (contracts, config, boundaries)
uv run pytest tests/test_health.py -q   # single file
uv run ruff check src tests             # lint
uv run ruff format --check src tests    # format check
uv run mypy src                         # type check (lenient baseline)
uv run uvicorn sovara.main:app --host 127.0.0.1 --port 8000
```

Interactive API docs: `http://127.0.0.1:8000/docs` · OpenAPI JSON: `/openapi.json`.

### Local model (Slice 1)

Default is Ollama at `http://127.0.0.1:11434` (`SOVARA_OLLAMA_MODEL`, default
`llama3.1`). Install Ollama and pull a model, e.g. `ollama pull llama3.1`.

No runtime installed? Use the deterministic dev harness (non-production):

```sh
SOVARA_MODEL_PROVIDER=echo uv run uvicorn sovara.main:app --host 127.0.0.1 --port 8000
```

End-to-end smoke test (streaming + errors):

```sh
curl -N -X POST http://127.0.0.1:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Explain what SOVARA is in one paragraph."}]}'
curl -X POST http://127.0.0.1:8000/api/v1/chat \
  -H "Content-Type: application/json" -d '{"model_id":"ghost","messages":[{"role":"user","content":"hi"}]}'
# -> {"error":{"code":"model_error",...}} with HTTP 502
```

Config: copy `.env.example` to `.env`, edit values (all `SOVARA_` prefixed).
Never commit `.env`.

## Frontend

From `frontend/`:

```sh
npm install
npm run dev     # :5173, /api proxied to backend :8000
npm run build   # tsc + vite bundle
npm test        # vitest (chat client, useChat, Composer, MessageList, CodeBlock)
```

Point at another backend with `VITE_API_BASE_URL` (see `.env.example`).

## Docker (full local stack)

From repo root:

```sh
docker compose up --build
docker compose config   # validate only
```

Services: `backend` (:8000, healthchecked) + `frontend` (:8080, nginx).
Both are local images; no cloud AI services.

## Testing conventions

- Behavior over implementation; one behavior per test.
- Contract tests live in `backend/tests/`: health/status shape, config
  defaults (air-gap!), error envelope, registry round-trips, policy gate,
  placeholder boundaries.
- New endpoint → new boundary test asserting shape + `phase0-placeholder`
  marker. New contract → round-trip/serialization test.

## Code conventions

- Backend: routes delegate (no logic), Pydantic validates input, services
  compose, domain stays dependency-free, errors use `SovaraError` subclasses.
- Logging: `get_logger(__name__)` + `bind_correlation(...)`; never log user
  content, tokens, or bodies.
- Network: any future egress must go through `NetworkPolicy.check_egress()`.
- Frontend: HTTP only in `src/api/client.ts`; strict TS (`noImplicitAny`,
  no `any`); feature folders own components; lazy-load heavy features.

## Contributing

1. Read the relevant ADR in `docs/adr/` before changing a boundary.
2. Keep `domain/` stable — changing a contract needs an ADR update.
3. Add/extend tests with the change; run `uv run pytest` before pushing.
4. Update `docs/api/OVERVIEW.md` when endpoints change.
