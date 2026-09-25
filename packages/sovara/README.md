# `@karthik-ak-git/sovara`

Sovara CLI for Windows x64 — installer + local-first agent commands + hardware monitor.

This package used to be installer-only (`sovara` downloaded the desktop `.exe`).
It now also exposes the opencode-style commands backed by the same logic as the
desktop app (`apps/desktop/src/main/services/hardwareProfile.ts`,
`hardwareCheck.ts`, `localRuntimeDetector.ts`), plus a single-shot `run`
against any local OpenAI-compatible endpoint (Ollama `:11434`, LM Studio
`:1234`, or `$SOVARA_SERVER_URL`).

The reference upstream lives at [`test/opencode`](../../../test/opencode)
(shallow clone of `anomalyco/opencode`, default branch `dev`) — read-only;
nothing in `test/opencode` is modified by this package.

## Install and run

The package is published through [GitHub Packages](https://github.com/karthik-ak-Git/SOVARA/pkgs/npm/%40karthik-ak-git%2Fsovara). Authenticate with a GitHub token that can read packages:

```powershell
$env:NODE_AUTH_TOKEN = "<GitHub PAT with read:packages>"
npx --yes --package=@karthik-ak-git/sovara@latest sovara status
```

Node.js is needed only for this CLI; the installed desktop application does not require Python, LM Studio, Ollama, or a separate Node.js runtime.

## Commands

| Command | What it does |
| :--- | :--- |
| `sovara install` | Fetch the `Sovara-versions` release, verify SHA-256, launch the `.exe` (Windows x64 only; old bare `sovara` behavior preserved) |
| `sovara hardware [--json]` | GPU / RAM / VRAM / storage monitor (`nvidia-smi` → `wmic` → `Get-CimInstance`) |
| `sovara models [--json]` | Local models: Sovara library (`$SOVARA_MODELS_DIR`, `~/.sovara/models`) + Ollama + LM Studio |
| `sovara fit --size-gb N [--params 7B] [--ctx 4096] [--json]` | Isolated-pool fit estimate (VRAM and RAM never summed) |
| `sovara run "prompt" [-m model] [--dir .] [--agent plan\|build] [--yolo] [--format text\|json] [-c\|--continue] [-s session] [--base-url URL]` | Single-shot agent run; `plan` is read-only, `build --yolo` allows `shell_exec` |
| `sovara serve [--port 4096]` | Local `/health`, `/v1/models`, `/status` server |
| `sovara status [--json]` | Hardware + runtimes + library summary |
| `sovara doctor [--json]` | Preflight checks |
| `sovara sessions` | Recent CLI sessions (`~/.sovara/sessions/*.jsonl`) |

`run` flag conventions (`-m`, `--dir`, `--format json`, `-c`, `-s`) mirror
`opencode run`; agents mirror opencode's `plan` (read-only) / `build`
(full-access) split, with tools named after the desktop capabilities
(`fs_read`/`fs_list` ≈ `read`, `shell_exec` ≈ `bash`).

## Examples

```powershell
sovara hardware
sovara fit --size-gb 4.2 --params 7B --ctx 4096
sovara models
sovara run "explain this repo" --dir . --agent plan
sovara run "list src files" --dir . --agent build --yolo -m ollama:qwen3:8b
sovara serve --port 4096
```

## Development

From this directory:

```powershell
node bin/sovara.js status
node bin/sovara.js doctor
npm run prepublishOnly
npm pack --dry-run
npm publish --access public --registry=https://npm.pkg.github.com
```

Publishing requires a GitHub token with `write:packages` permission. Do not commit that token or any other credentials.

## Source

- Repository: [karthik-ak-Git/SOVARA](https://github.com/karthik-ak-Git/SOVARA)
- Package source: [`packages/sovara`](https://github.com/karthik-ak-Git/SOVARA/tree/main/packages/sovara)
- Desktop application: [sovara-official.vercel.app](https://sovara-official.vercel.app)
