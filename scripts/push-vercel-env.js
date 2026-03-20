#!/usr/bin/env node
/**
 * Fully replace Vercel environment variables using local dotenv files.
 *
 * Usage:
 *   node scripts/push-vercel-env.js
 *   node scripts/push-vercel-env.js --file .env --target production
 *   node scripts/push-vercel-env.js --files .env,.env.local --target production,preview
 *   node scripts/push-vercel-env.js --dry-run
 *
 * Behavior:
 * - Loads and merges local dotenv files (later files override earlier files).
 * - Normalizes values so embedded line breaks become literal "\n" sequences.
 * - For each selected Vercel target, removes all existing variables first.
 * - Uploads the merged local variables using the Vercel CLI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const VALID_TARGETS = new Set(['development', 'preview', 'production']);
const DEFAULT_TARGETS = ['production', 'preview', 'development'];
const SAMPLE_FILE_MARKERS = ['example', 'sample', 'template', 'bak', 'backup'];

function parseArgs(argv) {
  const args = {
    files: [],
    targets: [...DEFAULT_TARGETS],
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--file') {
      args.files.push(String(argv[i + 1] || ''));
      i += 1;
      continue;
    }

    if (arg.startsWith('--file=')) {
      args.files.push(arg.slice('--file='.length));
      continue;
    }

    if (arg === '--files') {
      const value = String(argv[i + 1] || '');
      args.files.push(
        ...value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
      i += 1;
      continue;
    }

    if (arg.startsWith('--files=')) {
      args.files.push(
        ...arg
          .slice('--files='.length)
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
      continue;
    }

    if (arg === '--target') {
      args.targets = String(argv[i + 1] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!args.targets.length) {
        args.targets = [];
      }
      i += 1;
      continue;
    }

    if (arg.startsWith('--target=')) {
      args.targets = arg
        .slice('--target='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }

  args.files = Array.from(
    new Set(
      args.files
        .map((file) => file.trim())
        .filter(Boolean),
    ),
  );

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

function shouldIgnoreEnvFile(fileName) {
  if (!fileName.startsWith('.env')) {
    return true;
  }

  const lower = fileName.toLowerCase();
  return SAMPLE_FILE_MARKERS.some((marker) => {
    return lower.includes(`.${marker}`) || lower.endsWith(marker);
  });
}

function sortEnvFiles(files) {
  const score = (file) => {
    if (file === '.env') return 0;
    if (file === '.env.local') return 3;
    if (file.startsWith('.env.')) return 1;
    return 2;
  };

  return [...files].sort((a, b) => {
    const scoreDelta = score(a) - score(b);
    if (scoreDelta !== 0) return scoreDelta;
    return a.localeCompare(b);
  });
}

function discoverEnvFiles(repoRoot) {
  const files = fs
    .readdirSync(repoRoot)
    .filter((file) => {
      const abs = path.join(repoRoot, file);
      return fs.statSync(abs).isFile();
    })
    .filter((file) => !shouldIgnoreEnvFile(file))
    .filter((file) => file.startsWith('.env'));

  return sortEnvFiles(files);
}

function normalizeValue(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n');
}

function loadMergedEntries(repoRoot, files) {
  const merged = new Map();
  const normalizedKeys = new Set();
  const resolvedFiles = [];

  for (const file of files) {
    const envPath = path.resolve(repoRoot, file);
    if (!fs.existsSync(envPath)) {
      console.error(`Env file not found: ${envPath}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(envPath, 'utf8');
    const parsed = dotenv.parse(raw);
    resolvedFiles.push(envPath);

    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeValue(value);
      if (normalized !== value) {
        normalizedKeys.add(key);
      }
      merged.set(key, normalized);
    }
  }

  return {
    entries: [...merged.entries()],
    normalizedKeys: [...normalizedKeys],
    resolvedFiles,
  };
}

function pullExistingKeys(vercelBin, target, cwd) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-env-sync-'));
  const pullFile = path.join(tmpDir, `.env.${target}.pull`);

  try {
    const pullResult = runVercel(vercelBin, ['env', 'pull', pullFile, '--environment', target], { cwd });
    if (pullResult.status !== 0) {
      const output = `${pullResult.stdout || ''}${pullResult.stderr || ''}`.trim();
      console.error(`Failed pulling existing Vercel env vars for ${target}.`);
      console.error(output);
      process.exit(1);
    }

    if (!fs.existsSync(pullFile)) {
      return [];
    }

    const parsed = dotenv.parse(fs.readFileSync(pullFile, 'utf8'));
    return Object.keys(parsed);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { files, targets, dryRun } = parseArgs(process.argv.slice(2));

  if (!targets.length) {
    console.error('At least one target is required. Use --target production,preview,development');
    process.exit(1);
  }

  const invalidTargets = targets.filter((target) => !VALID_TARGETS.has(target));
  if (invalidTargets.length > 0) {
    console.error(`Invalid Vercel target(s): ${invalidTargets.join(', ')}`);
    process.exit(1);
  }

  const selectedFiles = files.length > 0 ? sortEnvFiles(files) : discoverEnvFiles(repoRoot);
  if (!selectedFiles.length) {
    console.error('No dotenv files found. Add .env files or pass --files/--file explicitly.');
    process.exit(1);
  }

  const { entries, normalizedKeys, resolvedFiles } = loadMergedEntries(repoRoot, selectedFiles);

  if (!entries.length) {
    console.error(`No environment variables found in: ${resolvedFiles.join(', ')}`);
    process.exit(1);
  }

  const vercelBin = resolveVercelBin(repoRoot);

  if (!dryRun) {
    const versionCheck = runVercel(vercelBin, ['--version'], { cwd: repoRoot });
    if (versionCheck.status !== 0) {
      console.error('Vercel CLI is not available. Install dependencies or run `npm install`.');
      console.error((versionCheck.stderr || versionCheck.stdout || '').trim());
      process.exit(1);
    }
  }

  console.log(`Using env files:\n- ${resolvedFiles.join('\n- ')}`);
  console.log(`Using Vercel CLI: ${vercelBin}`);
  console.log(`Targets: ${targets.join(', ')}`);
  console.log(`Local variables to upload: ${entries.length}`);
  if (normalizedKeys.length > 0) {
    console.log(`Normalized line breaks to "\\n" for ${normalizedKeys.length} key(s): ${normalizedKeys.join(', ')}`);
  }
  if (dryRun) {
    console.log('Dry run enabled: no changes will be made.');
  }

  let failures = 0;

  for (const target of targets) {
    console.log(`\nSyncing Vercel ${target}...`);

    let keysToRemove = [];

    if (dryRun) {
      console.log('  [dry-run] would pull existing keys and remove all of them.');
    } else {
      keysToRemove = pullExistingKeys(vercelBin, target, repoRoot);
      if (keysToRemove.length === 0) {
        console.log('  No existing keys to remove.');
      } else {
        console.log(`  Removing ${keysToRemove.length} existing key(s)...`);
      }
    }

    for (const key of keysToRemove) {
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
      console.log(`  removed ${key}`);
    }

    console.log(`  Uploading ${entries.length} local key(s)...`);
    for (const [key, value] of entries) {
      if (dryRun) {
        console.log(`  [dry-run] would add ${key}`);
        continue;
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
