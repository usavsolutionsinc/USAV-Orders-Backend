#!/usr/bin/env node
/**
 * Push environment variables from a dotenv file to Vercel using the Vercel CLI.
 *
 * Usage:
 *   node scripts/push-vercel-env.js
 *   node scripts/push-vercel-env.js --file .env.local --target preview
 *   node scripts/push-vercel-env.js --file .env --target production,preview
 *
 * Notes:
 * - Only keys present in the selected dotenv file are updated.
 * - Existing keys are removed first so re-runs stay idempotent.
 * - Requires an authenticated Vercel CLI session and a linked Vercel project.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const VALID_TARGETS = new Set(['development', 'preview', 'production']);

function parseArgs(argv) {
  const args = {
    file: '.env',
    targets: ['production'],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--file') {
      args.file = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length);
      continue;
    }

    if (arg === '--target') {
      args.targets = String(argv[i + 1] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg.startsWith('--target=')) {
      args.targets = arg
        .slice('--target='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  return args;
}

function resolveVercelBin(repoRoot) {
  const localBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel');

  if (fs.existsSync(localBin)) return localBin;
  return 'vercel';
}

function runVercel(vercelBin, args, options = {}) {
  return spawnSync(vercelBin, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { file, targets } = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(repoRoot, file);

  if (!fs.existsSync(envFile)) {
    console.error(`Env file not found: ${envFile}`);
    process.exit(1);
  }

  if (!targets.length) {
    console.error('At least one target is required. Use --target production,preview,development');
    process.exit(1);
  }

  const invalidTargets = targets.filter((target) => !VALID_TARGETS.has(target));
  if (invalidTargets.length > 0) {
    console.error(`Invalid Vercel target(s): ${invalidTargets.join(', ')}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(envFile);
  const parsed = dotenv.parse(raw);
  const entries = Object.entries(parsed);

  if (!entries.length) {
    console.error(`No environment variables found in ${envFile}`);
    process.exit(1);
  }

  const vercelBin = resolveVercelBin(repoRoot);
  const versionCheck = runVercel(vercelBin, ['--version'], { cwd: repoRoot });
  if (versionCheck.status !== 0) {
    console.error('Vercel CLI is not available. Install dependencies or run `npm install`.');
    console.error((versionCheck.stderr || versionCheck.stdout || '').trim());
    process.exit(1);
  }

  console.log(`Using env file: ${envFile}`);
  console.log(`Using Vercel CLI: ${vercelBin}`);
  console.log(`Targets: ${targets.join(', ')}`);

  let failures = 0;

  for (const target of targets) {
    console.log(`\nPushing ${entries.length} variables to Vercel ${target}...`);

    for (const [key, value] of entries) {
      const removeResult = runVercel(vercelBin, ['env', 'rm', key, target, '--yes'], {
        cwd: repoRoot,
      });

      if (removeResult.status !== 0) {
        const removeOutput = `${removeResult.stdout || ''}${removeResult.stderr || ''}`;
        const missingVar = /not found|does not exist|could not find/i.test(removeOutput);
        if (!missingVar) {
          console.error(`Failed removing ${key} from ${target}`);
          console.error(removeOutput.trim());
          failures += 1;
          continue;
        }
      }

      const addResult = runVercel(vercelBin, ['env', 'add', key, target], {
        cwd: repoRoot,
        input: `${value}\n`,
      });

      if (addResult.status !== 0) {
        console.error(`Failed adding ${key} to ${target}`);
        console.error(`${addResult.stdout || ''}${addResult.stderr || ''}`.trim());
        failures += 1;
        continue;
      }

      console.log(`  synced ${key}`);
    }
  }

  if (failures > 0) {
    console.error(`\nCompleted with ${failures} failure(s).`);
    process.exit(1);
  }

  console.log('\nVercel env sync completed successfully.');
}

main();
