#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

console.log('=============================================');
console.log('      Downloading Sovara (Local AI Agent)    ');
console.log('=============================================\n');

if (os.platform() !== 'win32') {
  console.error('\x1b[31mError: Sovara currently only supports Windows.\x1b[0m');
  process.exit(1);
}

const API_URL = 'https://api.github.com/repos/karthik-ak-Git/SOVARA/releases/tags/Sovara-versions';
const HEADERS = { 'User-Agent': 'sovara-installer' };

console.log('\x1b[33mFetching release data from GitHub (Sovara-versions)...\x1b[0m');

function getReleaseData() {
  return new Promise((resolve, reject) => {
    https.get(API_URL, { headers: HEADERS }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub API returned ${res.statusCode}`));
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    // Follow redirects
    const request = (reqUrl) => {
      https.get(reqUrl, { headers: HEADERS }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          fs.unlink(dest, () => reject(new Error(`Download failed with status ${res.statusCode}`)));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    };
    
    request(url);
  });
}

async function main() {
  try {
    const release = await getReleaseData();
    const asset = release.assets.find(a => a.name.endsWith('.exe'));
    
    if (!asset) {
      console.error('\x1b[31mError: Could not find a Windows .exe installer in the release.\x1b[0m');
      process.exit(1);
    }

    const outFile = path.join(os.tmpdir(), asset.name);
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
    
    console.log(`\x1b[33mDownloading ${asset.name} (${sizeMB} MB)...\x1b[0m`);
    await downloadFile(asset.browser_download_url, outFile);
    
    console.log('\x1b[32mDownload complete! Launching installer...\x1b[0m');
    
    // Detach and run the installer
    const child = spawn(outFile, [], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    console.log('\n\x1b[36mSetup is now running. You can close this window.\x1b[0m');
  } catch (err) {
    console.error('\x1b[31mAn error occurred during installation:\x1b[0m', err.message);
    process.exit(1);
  }
}

main();
