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

        const totalBytes = parseInt(res.headers['content-length'], 10);
        let downloadedBytes = 0;

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          
          if (totalBytes) {
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            const progressBarLength = 30;
            const filledLength = Math.round((progressBarLength * downloadedBytes) / totalBytes);
            const bar = '█'.repeat(filledLength) + '-'.repeat(progressBarLength - filledLength);
            
            process.stdout.write(`\r\x1b[33mProgress: [${bar}] ${percent}% | ${downloadedMB} MB / ${totalMB} MB\x1b[0m`);
          } else {
            process.stdout.write(`\r\x1b[33mDownloaded: ${downloadedMB} MB\x1b[0m`);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          process.stdout.write('\n');
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
      stdio: 'ignore',
      shell: true
    });
    
    child.on('error', (err) => {
      console.error('\x1b[31mFailed to start installer:\x1b[0m', err.message);
      console.log(`\x1b[33mYou can run it manually from: ${outFile}\x1b[0m`);
    });

    child.unref();

    console.log('\n\x1b[36mSetup is now running. You can close this window.\x1b[0m');
  } catch (err) {
    console.error('\x1b[31mAn error occurred during installation:\x1b[0m', err.message);
    process.exit(1);
  }
}

main();
