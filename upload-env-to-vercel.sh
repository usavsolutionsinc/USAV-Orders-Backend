#!/bin/bash
# ============================================================
# upload-env-to-vercel.sh
# Wipes ALL Vercel env vars for development/preview/production
# and re-uploads every key from .env to each target.
# Usage: bash upload-env-to-vercel.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
TARGETS=(development preview production)

# ── Pre-flight checks ─────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

# Resolve vercel binary — global install, local node_modules, or npx
VERCEL_BIN=""
if command -v vercel &>/dev/null; then
  VERCEL_BIN="vercel"
elif [ -x "$SCRIPT_DIR/node_modules/.bin/vercel" ]; then
  VERCEL_BIN="$SCRIPT_DIR/node_modules/.bin/vercel"
else
  echo "Vercel CLI not found globally — installing locally..."
  npm install --prefix "$SCRIPT_DIR" vercel --save-dev 2>&1 | grep -v "^npm warn"
  if [ -x "$SCRIPT_DIR/node_modules/.bin/vercel" ]; then
    VERCEL_BIN="$SCRIPT_DIR/node_modules/.bin/vercel"
  else
    echo "Falling back to npx vercel..."
    VERCEL_BIN="npx --yes vercel"
  fi
fi
echo "Using Vercel CLI: $VERCEL_BIN"
export VERCEL_BIN

if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          Vercel Env — Full Replace All Targets           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Remove all existing env vars for each target ───────
echo "▶ Step 1/2 — Removing existing Vercel env vars..."
echo ""

for target in "${TARGETS[@]}"; do
  echo "  Target: $target"
  EXISTING=$($VERCEL_BIN env ls "$target" 2>&1 \
    | awk '/^[[:space:]]+[A-Za-z_][A-Za-z0-9_]/ { gsub(/^[[:space:]]+/, ""); print $1 }' \
    || true)

  if [ -z "$EXISTING" ]; then
    echo "    (no vars found)"
    continue
  fi

  while IFS= read -r var; do
    [ -z "$var" ] && continue
    echo "    Removing: $var"
    $VERCEL_BIN env rm "$var" "$target" --yes 2>/dev/null || echo "    (skip — $var not found)"
  done <<< "$EXISTING"
done

echo ""
echo "▶ Step 2/2 — Uploading .env to Vercel..."
echo ""

# ── Step 2: Parse .env and upload each var to every target ────
export ENV_FILE
export TARGETS_CSV="$(IFS=,; echo "${TARGETS[*]}")"

node <<'JSEOF'
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const envFile = process.env.ENV_FILE;
const vercelCmd = String(process.env.VERCEL_BIN || '').split(' ').filter(Boolean);
const targets = String(process.env.TARGETS_CSV || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const parsed = dotenv.parse(fs.readFileSync(envFile));
const entries = Object.entries(parsed);

if (entries.length === 0) {
  console.error(`No environment variables found in ${envFile}`);
  process.exit(1);
}

let success = 0;
let failed = 0;

for (const target of targets) {
  console.log(`  Target: ${target}`);
  for (const [key, value] of entries) {
    const result = spawnSync(vercelCmd[0], [...vercelCmd.slice(1), 'env', 'add', key, target], {
      input: `${value}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
      console.log(`    ✓ ${key}`);
      success += 1;
    } else {
      const err = `${result.stderr || ''}${result.stdout || ''}`.trim();
      console.log(`    ✗ ${key} → ${err}`);
      failed += 1;
    }
  }
}

console.log('');
console.log('='.repeat(52));
console.log(`Done — ${success} uploaded, ${failed} failed.`);
console.log('='.repeat(52));

if (failed > 0) process.exit(1);
JSEOF
