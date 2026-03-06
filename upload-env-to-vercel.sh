#!/bin/bash
# ============================================================
# upload-env-to-vercel.sh
# Wipes ALL production env vars on Vercel and re-uploads from .env
# Usage: bash upload-env-to-vercel.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

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

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but not found."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║        Vercel Production Env — Full Replace              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Remove all existing production env vars ───────────
echo "▶ Step 1/2 — Removing existing production env vars..."
echo ""

EXISTING=$($VERCEL_BIN env ls production 2>&1 \
  | awk '/^[[:space:]]+[A-Za-z_][A-Za-z0-9_]/ { gsub(/^[[:space:]]+/, ""); print $1 }' \
  || true)

if [ -z "$EXISTING" ]; then
  echo "  (no existing production vars found)"
else
  while IFS= read -r var; do
    [ -z "$var" ] && continue
    echo "  Removing: $var"
    $VERCEL_BIN env rm "$var" production --yes 2>/dev/null || echo "  (skip — $var not found)"
  done <<< "$EXISTING"
fi

echo ""
echo "▶ Step 2/2 — Uploading .env to production..."
echo ""

# ── Step 2: Parse .env and upload each var via Python ─────────
export ENV_FILE

python3 <<'PYEOF'
import subprocess, os, sys

env_file = os.environ["ENV_FILE"]
env_vars = {}

with open(env_file, "r") as f:
    lines = f.readlines()

i = 0
while i < len(lines):
    line = lines[i].rstrip("\n")

    # Skip blank lines and comments
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        i += 1
        continue

    if "=" not in line:
        i += 1
        continue

    key, _, raw_value = line.partition("=")
    key = key.strip()

    # Skip commented-out or empty keys
    if not key or key.startswith("#") or not key.replace("_", "").isalnum():
        i += 1
        continue

    # Quoted value (possibly multi-line, e.g. GOOGLE_PRIVATE_KEY)
    if raw_value.startswith('"'):
        inner = raw_value[1:]
        if inner.endswith('"'):
            # Same-line closing quote
            value = inner[:-1]
        else:
            # Multi-line: keep reading until a line ending with "
            parts = [inner]
            i += 1
            while i < len(lines):
                next_line = lines[i].rstrip("\n")
                if next_line.endswith('"'):
                    parts.append(next_line[:-1])
                    break
                parts.append(next_line)
                i += 1
            value = "\n".join(parts)
    else:
        value = raw_value.strip()

    env_vars[key] = value
    i += 1

success, failed = 0, 0

for key, value in env_vars.items():
    vercel_cmd = os.environ["VERCEL_BIN"].split()
    result = subprocess.run(
        vercel_cmd + ["env", "add", key, "production"],
        input=value,
        text=True,
        capture_output=True,
    )
    if result.returncode == 0:
        print(f"  ✓  {key}")
        success += 1
    else:
        err = result.stderr.strip() or result.stdout.strip()
        print(f"  ✗  {key}  →  {err}")
        failed += 1

print("")
print(f"{'═'*52}")
print(f"  Done — {success} uploaded, {failed} failed.")
print(f"{'═'*52}")
PYEOF
