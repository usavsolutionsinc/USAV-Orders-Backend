#!/usr/bin/env node
/**
 * Runs TypeScript regression tests for scan routing (shared with the app).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const scriptTs = path.join(__dirname, 'test-station-detection.ts');
const cwd = path.join(__dirname, '..');

const r = spawnSync('npx', ['--yes', 'tsx', scriptTs], {
  stdio: 'inherit',
  cwd,
  shell: process.platform === 'win32',
  env: { ...process.env },
});

process.exit(r.status === null ? 1 : r.status);
