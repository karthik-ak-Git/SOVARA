# Sovara Desktop Implementation Plan

**Status:** Completed changes and follow-up work  
**Last updated:** 2026-09-25

## Completed

- Removed the tracked `apps/web` application and Vercel/Next.js packaging references.
- Removed Python sidecars, provisioning services, IPC channels, settings, voice controls, and bundled Python resources.
- Replaced web search/crawl orchestration with TypeScript-only search and bounded page reading.
- Removed the Python-backed Laya decision manager and retained deterministic hardware-aware routing.
- Made the renderer light-only and removed the theme selector and dark CSS block.
- Added a semantic CSS token layer and normalized shell/status/input surfaces.
- Added PATH-independent NVIDIA `nvidia-smi` fallbacks for Windows installs where Electron does not inherit the expected PATH.
- Regenerated `pnpm-lock.yaml` for the desktop-only workspace.

## Follow-up quality work

1. Replace remaining one-off inline colors in high-traffic views with semantic classes.
2. Remove dead compatibility styles once screenshots and visual regression checks confirm no consumers remain.
3. Add a regression test for the NVIDIA candidate probe and its CSV parser.
4. Run the full desktop test matrix on a clean install with no Python provisioned.
5. Package a Windows installer and inspect the packaged resource list for Python artifacts.
6. Add a release note explaining the removal of voice/OCR and web companion surfaces.

## Change rules

- Do not add a hosted renderer or a second product entry point.
- Do not add a Python runtime to satisfy a feature; implement it in TypeScript or defer it.
- Keep model placement observable and do not claim GPU acceleration without a successful probe.
- Preserve the semantic token system when making visual changes.
