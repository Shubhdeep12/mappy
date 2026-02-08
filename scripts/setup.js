#!/usr/bin/env node
/**
 * One-time setup: install deps and copy .env.example → .env in backend and frontend.
 * Run from repo root: pnpm setup
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function log(msg) {
  console.log(msg);
}

function copyEnvIfMissing(pkgName, envDir) {
  const example = path.join(envDir, '.env.example');
  const dest = path.join(envDir, '.env');
  if (!existsSync(example)) {
    log(`  Skip ${pkgName}: no .env.example found`);
    return;
  }
  if (existsSync(dest)) {
    log(`  ${pkgName}: .env already exists, skipping`);
    return;
  }
  const content = readFileSync(example, 'utf8');
  writeFileSync(dest, content, 'utf8');
  log(`  ${pkgName}: created .env from .env.example`);
}

// Node version check (advisory)
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (major < 20) {
  log(`Warning: Node ${nodeVersion} detected. Recommended: Node 22+ (or at least 20).`);
}

log('Installing dependencies...');
execSync('pnpm install', { cwd: root, stdio: 'inherit' });

log('Setting up env files (copy .env.example → .env if missing)...');
copyEnvIfMissing('backend', path.join(root, 'packages', 'backend'));
copyEnvIfMissing('frontend', path.join(root, 'packages', 'frontend'));

log('');
log('Setup complete. Next steps:');
log('  1. pnpm dev          # start backend + frontend');
log('  2. Open http://localhost:3000 in the browser');
log('  3. Add Gemini + Google Maps API keys in the app (Settings), or use free mode with Ollama + OSM');
log('');
