#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PLATFORMS = {
  'darwin arm64': ['@translate-local/tl-darwin-arm64', 'bin/tl'],
  'darwin x64':   ['@translate-local/tl-darwin-x64',   'bin/tl'],
  'linux x64':    ['@translate-local/tl-linux-x64',    'bin/tl'],
  'linux arm64':  ['@translate-local/tl-linux-arm64',  'bin/tl'],
  'win32 x64':    ['@translate-local/tl-win32-x64',    'bin/tl.exe'],
};

const key = `${process.platform} ${process.arch}`;
const entry = PLATFORMS[key];

if (!entry) {
  console.error(`[tl] Unsupported platform: ${key}`);
  console.error(`[tl] Supported: ${Object.keys(PLATFORMS).join(', ')}`);
  process.exit(1);
}

const [pkg, sub] = entry;

let binPath;
try {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  binPath = path.join(path.dirname(pkgJson), sub);
} catch {
  console.error(`[tl] Could not find the "${pkg}" package.`);
  console.error(`[tl] This usually means npm was run with --no-optional.`);
  console.error(`[tl] Try: npm install -g @translate-local/tl --force`);
  process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`[tl] Failed to run binary at ${binPath}:`, result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
