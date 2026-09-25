#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const API_URL = 'https://api.github.com/repos/karthik-ak-Git/SOVARA/releases/tags/Sovara-versions';
const HEADERS = { 'User-Agent': 'sovara-installer' };

function selectWindowsInstaller(assets) {
  const installers = (assets || []).filter((asset) => /\.exe$/i.test(asset.name || ''));
  return installers.find((asset) => /sovara.*(?:setup|installer)/i.test(asset.name))
    || installers.find((asset) => /(?:setup|installer).*\.exe$/i.test(asset.name))
    || installers.find((asset) => !/(?:blockmap|debug|update|helper)/i.test(asset.name))
    || null;
}

async function getReleaseData() {
  const response = await fetch(API_URL, { headers: HEADERS });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response.json();
}

async function downloadFile(url, destination) {
  const partial = `${destination}.part`;
  await fsPromises.rm(partial, { force: true });
  console.log(`Downloading ${path.basename(destination)}...`);
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
  await fsPromises.rename(partial, destination);
}

async function verifyDigest(filePath, expectedDigest) {
  if (!expectedDigest || !expectedDigest.startsWith('sha256:')) return null;
  const expected = expectedDigest.slice('sha256:'.length).toLowerCase();
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  const actual = hash.digest('hex').toLowerCase();
  if (actual !== expected) throw new Error(`Installer checksum mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

async function main() {
  if (os.platform() !== 'win32') {
    console.error('Sovara currently only supports Windows x64.');
    process.exitCode = 1;
    return;
  }

  console.log('=============================================');
  console.log('      Downloading Sovara (Local AI Agent)    ');
  console.log('=============================================\n');

  const release = await getReleaseData();
  const asset = selectWindowsInstaller(release.assets);
  if (!asset) throw new Error('No Windows installer asset was found in the Sovara release.');

  const safeName = path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const outFile = path.join(os.tmpdir(), safeName);
  const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
  console.log(`Release asset: ${asset.name} (${sizeMB} MB)`);
  await downloadFile(asset.browser_download_url, outFile);

  const digest = await verifyDigest(outFile, asset.digest);
  if (digest) console.log(`Verified SHA-256: ${digest}`);

  console.log('Download complete. Launching installer...');
  const child = spawn(outFile, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', (error) => {
    console.error(`Failed to start installer: ${error.message}`);
    console.log(`Run it manually from: ${outFile}`);
  });
  child.unref();
  console.log('Setup is now running. You can close this window.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { selectWindowsInstaller, verifyDigest, main, getReleaseData, downloadFile };
