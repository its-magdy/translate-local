#!/usr/bin/env node
// Copies compiled binaries into platform packages and stamps the version.
// Usage: node scripts/stage-npm-packages.mjs <version>
// Example: node scripts/stage-npm-packages.mjs 0.2.0
//
// Expects the following files to exist (downloaded from CI artifacts):
//   artifacts/tl-darwin-arm64
//   artifacts/tl-darwin-x64
//   artifacts/tl-linux-x64
//   artifacts/tl-linux-arm64
//   artifacts/tl-windows-x64.exe

import { copyFileSync, chmodSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/stage-npm-packages.mjs <version>');
  process.exit(1);
}

const PLATFORMS = [
  { pkg: 'npm-tl-darwin-arm64', src: 'tl-darwin-arm64',   dst: 'tl'     },
  { pkg: 'npm-tl-darwin-x64',   src: 'tl-darwin-x64',     dst: 'tl'     },
  { pkg: 'npm-tl-linux-x64',    src: 'tl-linux-x64',      dst: 'tl'     },
  { pkg: 'npm-tl-linux-arm64',  src: 'tl-linux-arm64',    dst: 'tl'     },
  { pkg: 'npm-tl-win32-x64',    src: 'tl-windows-x64.exe', dst: 'tl.exe' },
];

// Stamp version into a package.json
function bumpVersion(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// Stage each platform binary
for (const { pkg, src, dst } of PLATFORMS) {
  const srcPath = join(root, 'artifacts', src);
  const dstDir  = join(root, 'packages', pkg, 'bin');
  const dstPath = join(dstDir, dst);

  copyFileSync(srcPath, dstPath);
  if (!dst.endsWith('.exe')) chmodSync(dstPath, 0o755);

  bumpVersion(join(root, 'packages', pkg, 'package.json'));
  console.log(`staged ${src} -> packages/${pkg}/bin/${dst}`);
}

// Stamp wrapper version + optionalDependencies versions
const wrapperPath = join(root, 'packages', 'npm-tl', 'package.json');
const wrapper = JSON.parse(readFileSync(wrapperPath, 'utf8'));
wrapper.version = version;
for (const dep of Object.keys(wrapper.optionalDependencies)) {
  wrapper.optionalDependencies[dep] = version;
}
writeFileSync(wrapperPath, JSON.stringify(wrapper, null, 2) + '\n');
console.log(`stamped packages/npm-tl/package.json -> ${version}`);
