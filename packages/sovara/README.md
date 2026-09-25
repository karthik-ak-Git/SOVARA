# `@karthik-ak-git/sovara`

The Sovara installer CLI for Windows x64.

This small Node.js package downloads the latest Sovara desktop release, verifies the release SHA-256 digest when GitHub provides one, and launches the installer without constructing a shell command.

## Install and run

The package is published through [GitHub Packages](https://github.com/karthik-ak-Git/SOVARA/pkgs/npm/%40karthik-ak-git%2Fsovara). Authenticate with a GitHub token that can read packages:

```powershell
$env:NODE_AUTH_TOKEN = "<GitHub PAT with read:packages>"
npx --yes --package=@karthik-ak-git/sovara@latest sovara
```

Sovara currently supports Windows x64. Node.js is needed only for this installer CLI; the installed desktop application does not require Python, LM Studio, Ollama, or a separate Node.js runtime.

## What it does

1. Fetches the `Sovara-versions` GitHub Release metadata.
2. Selects the Sovara Windows `.exe` asset.
3. Downloads it to the operating system temporary directory.
4. Verifies the release digest when available.
5. Launches the installer directly, without a shell command string.

## Development

From this directory:

```powershell
npm pack --dry-run
npm publish --access public --registry=https://npm.pkg.github.com
```

Publishing requires a GitHub token with `write:packages` permission. Do not commit that token or any other credentials.

## Source

- Repository: [karthik-ak-Git/SOVARA](https://github.com/karthik-ak-Git/SOVARA)
- Package source: [`packages/sovara`](https://github.com/karthik-ak-Git/SOVARA/tree/main/packages/sovara)
- Desktop application: [sovara-official.vercel.app](https://sovara-official.vercel.app)
