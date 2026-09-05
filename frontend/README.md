# SOVARA Frontend (Phase 0)

UI boundary only: static overview + backend status display.

- HTTP lives in `src/api/client.ts` — components never call `fetch` directly.
- No business logic in components; no state management, no routing yet.
- Contract types in `src/api/types.ts` mirror the backend OpenAPI surface.

## Commands

```sh
npm install
npm run dev      # vite dev server on :5173 (proxies /api to backend :8000)
npm run build    # typecheck + production bundle
```
