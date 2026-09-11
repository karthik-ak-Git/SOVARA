# @sovara/desktop — fresh rebuild (part by part)

The previous full implementation is preserved untouched as a reference at
[`../desktop1/`](../desktop1/) (excluded from the pnpm workspace).

Parts are brought over from `desktop1` one at a time, in this order
(suggested — confirm before each step):

1. `src/shared/` — types + IPC channels/schemas (no runtime code)
2. `src/main/` backend — AppBackend, ports/adapters, storage, services
3. `src/main/` shell — window, preload, Next.js server lifecycle
4. `tests/` — contracts, persistence, UI, sovereignty proofs
5. Packaging — electron-builder config, build scripts

The UI itself lives in `../web/` (Next.js) and was not touched.
