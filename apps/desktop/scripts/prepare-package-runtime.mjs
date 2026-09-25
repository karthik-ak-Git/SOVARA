#!/usr/bin/env node

/**
 * Stage the pinned Windows CUDA llama.cpp runtime for the installer.
 *
 * The runtime is intentionally not committed to git. The Windows build command
 * downloads the two pinned release assets, extracts them into resources/runtime,
 * and electron-builder copies that directory into the packaged application.
 */
import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const resourceRoot = join(desktopDir, 'resources')
const cacheDir = join(resourceRoot, 'runtime-cache')
const runtimeDir = join(resourceRoot, 'runtime', 'llama.cpp', 'b10900')
const manifestPath = join(resourceRoot, 'runtime', 'runtime-manifest.json')
const build = 'b10900'
const baseUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${build}`
const assets = [
  `${baseUrl}/llama-${build}-bin-win-cuda-12.4-x64.zip`,
  `${baseUrl}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
]

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function findRuntimeExecutable(dir, depth = 0) {
  if (depth > 4 || !(await exists(dir))) return null
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name.toLowerCase()
    if (name === 'llama-server.exe' || name === 'llama-srv.exe') return join(dir, entry.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const hit = await findRuntimeExecutable(join(dir, entry.name), depth + 1)
    if (hit) return hit
  }
  return null
}

async function download(url, destination) {
  if (await exists(destination)) return
  const partial = `${destination}.part`
  await rm(partial, { force: true })
  console.log(`[runtime] downloading ${url}`)
  const response = await fetch(url, { headers: { 'User-Agent': 'Sovara-package-builder' } })
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  await rename(partial, destination)
}

async function extract(zipPath, destination) {
  if (process.platform !== 'win32') {
    throw new Error('Windows runtime staging requires Windows PowerShell Expand-Archive')
  }
  await mkdir(destination, { recursive: true })
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath ${quotePowerShell(zipPath)} -DestinationPath ${quotePowerShell(destination)} -Force`,
  ], { timeout: 180_000, windowsHide: true })
}

async function copyDllsBesideExe(root, exeDir, seen = new Set()) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      await copyDllsBesideExe(full, exeDir, seen)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dll')) continue
    const target = join(exeDir, entry.name)
    if (resolve(full) === resolve(target) || seen.has(resolve(target))) continue
    await cp(full, target, { force: true })
    seen.add(resolve(target))
  }
}

async function main() {
  await mkdir(cacheDir, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })

  const existingExe = await findRuntimeExecutable(runtimeDir)
  const manifestExists = await exists(manifestPath)
  if (existingExe && manifestExists) {
    console.log(`[runtime] already staged: ${existingExe}`)
    return
  }

  for (const url of assets) {
    const name = url.slice(url.lastIndexOf('/') + 1)
    const zipPath = join(cacheDir, name)
    await download(url, zipPath)
    await extract(zipPath, runtimeDir)
  }

  const exe = await findRuntimeExecutable(runtimeDir)
  if (!exe) throw new Error('packaged runtime archive did not contain llama-server.exe or llama-srv.exe')
  await copyDllsBesideExe(runtimeDir, dirname(exe))

  await writeFile(manifestPath, `${JSON.stringify({
    build,
    executable: exe,
    assets,
    stagedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')

  const exeStat = await stat(exe)
  if (exeStat.size < 1024) throw new Error('packaged llama runtime executable is unexpectedly small')
  console.log(`[runtime] staged ${exe}`)
}

main().catch((error) => {
  console.error(`[runtime] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
