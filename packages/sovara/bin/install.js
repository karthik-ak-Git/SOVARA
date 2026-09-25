#!/usr/bin/env node
'use strict';
// Backward-compatible entry: `sovara` used to mean "install the desktop app".
// Preserved so existing `npx sovara` flows keep working; the full CLI lives in
// bin/sovara.js (install | hardware | models | fit | run | serve | status).
const impl = require('./install-impl');

if (require.main === module) {
  impl.main().catch((error) => {
    console.error(`Installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = impl;
