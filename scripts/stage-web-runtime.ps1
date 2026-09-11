# Stages a self-contained Next.js runtime for the Electron shell.
#
# Layout produced at apps/desktop/web-runtime/:
#   package.json, node_modules/ (production deps only, via `pnpm deploy`),
#   next.config.mjs, .next/ (production build).
# The Electron main process spawns `next start` from this directory, so the
# packaged app needs no separate Node hosting and no symlink privileges
# (unlike `output: standalone` tracing, which requires symlinks on Windows).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/stage-web-runtime.ps1
# Must run from the repository root.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps\web'
$stage = Join-Path $root 'apps\desktop\web-runtime'

Write-Host "[stage] building @sovara/web..."
& pnpm --filter @sovara/web build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }

if (Test-Path -LiteralPath $stage) {
  Write-Host '[stage] removing previous runtime...'
  Remove-Item -LiteralPath $stage -Recurse -Force
}

Write-Host '[stage] deploying production dependencies...'
& pnpm --filter @sovara/web --prod deploy --legacy $stage
if ($LASTEXITCODE -ne 0) { throw 'pnpm deploy failed' }

Write-Host '[stage] copying .next build + config...'
Copy-Item -Path (Join-Path $web '.next') -Destination (Join-Path $stage '.next') -Recurse -Force
Copy-Item -Path (Join-Path $web 'next.config.mjs') -Destination (Join-Path $stage 'next.config.mjs') -Force

$cli = Join-Path $stage 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $cli)) { throw "next CLI missing at $cli" }
Write-Host "[stage] runtime ready at $stage"
