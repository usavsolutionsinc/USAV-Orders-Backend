#!/usr/bin/env node
/**
 * Knip baseline gate.
 *
 * Knip 5.x has no native baseline file, so this wraps it: we snapshot the
 * KNOWN dead-code backlog into `knip-baseline.json` (a stable, sorted set of
 * line-independent fingerprints) and fail CI only when a run surfaces a finding
 * that is NOT already in the baseline — i.e. NEW dead code a change introduced.
 *
 * Why fingerprints instead of the raw `knip --reporter json`:
 *   - Raw JSON carries line/col/pos, which drift on every unrelated edit and
 *     would make the committed baseline churn and produce false "new finding"
 *     hits. A fingerprint is `category|file|name` only — stable across edits.
 *   - Removing dead code shrinks the current set, so cleanup NEVER fails the
 *     gate; only additions (current \ baseline) do.
 *
 * Determinism — why we CLEAR the cache then run with `--cache`:
 *   Plain `knip` resolves files that touch optional / conditionally loaded deps
 *   (e.g. googleapis, the zen decision engine) in an order-dependent way, so a
 *   handful of findings flip in/out run-to-run and session-to-session — that
 *   would flake the gate. Running with `--cache` from a CLEAN cache takes the
 *   deterministic code path: a freshly-rebuilt cache yields a byte-identical
 *   finding set every time (verified over many clean cold rebuilds). A *stale*
 *   cache, however, can carry an older variant, so we wipe `node_modules/.cache/
 *   knip` before each run. This exactly matches CI, where `npm ci` wipes
 *   node_modules (hence the knip cache) on every job — so the baseline captured
 *   locally and the set CI computes are the same.
 *
 * Usage:
 *   node scripts/knip-gate.mjs            # CHECK: fail on findings not in baseline
 *   node scripts/knip-gate.mjs --update   # WRITE/refresh knip-baseline.json
 *   node scripts/knip-gate.mjs --from <knip.json>   # diff a pre-captured run (tests)
 *
 * package.json:
 *   npm run knip            -> check (the CI gate)
 *   npm run knip:baseline   -> refresh the baseline after intentional changes
 *
 * See docs/DEAD_CODE_CLEANUP_PLAN.md (Phase 7 — prevention/guardrails).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(REPO_ROOT, 'knip-baseline.json');
const KNIP_CACHE_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'knip');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update') || args.includes('--baseline');
const fromIdx = args.indexOf('--from');
const FROM_FILE = fromIdx !== -1 ? args[fromIdx + 1] : process.env.KNIP_GATE_INPUT;

/** Run knip's JSON reporter (or read a pre-captured file) and parse it. */
function getKnipReport() {
  if (FROM_FILE) {
    return JSON.parse(readFileSync(FROM_FILE, 'utf8'));
  }
  // Wipe any stale knip cache so `--cache` rebuilds clean — the deterministic,
  // CI-matching path (see header). Best-effort; absence is fine.
  rmSync(KNIP_CACHE_DIR, { recursive: true, force: true });
  let stdout;
  try {
    // --no-exit-code: knip returns 0 even with findings, so this never throws
    //   on "found dead code"; a throw here means knip itself failed.
    // --cache: REQUIRED for determinism (see header). Do not remove.
    stdout = execFileSync('npx', ['knip', '--reporter', 'json', '--no-exit-code', '--cache'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    console.error('✖ knip gate: failed to run knip.');
    if (err.stderr) console.error(String(err.stderr).trim());
    process.exit(2);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // The JSON reporter prints pure JSON to stdout; recover if anything leaked.
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(stdout.slice(start, end + 1));
    console.error('✖ knip gate: could not parse knip JSON output.');
    process.exit(2);
  }
}

/** Name of a finding entry — knip uses {name,...} objects or bare strings. */
function entryName(e) {
  if (e == null) return '';
  return typeof e === 'string' ? e : (e.name ?? e.symbol ?? JSON.stringify(e));
}

/**
 * Reduce a knip report to a SET of stable, line-independent fingerprints.
 * Covers every category knip emits (files, exports, types, deps, binaries,
 * unlisted/unresolved, duplicates, enumMembers, catalog, …) generically, so
 * new knip categories are picked up without code changes.
 */
function fingerprints(report) {
  const set = new Set();

  // Top-level unused files.
  for (const f of report.files || []) set.add(`file|${f}`);

  for (const issue of report.issues || []) {
    const file = issue.file || '(unknown)';
    for (const [key, value] of Object.entries(issue)) {
      if (key === 'file') continue;

      if (key === 'duplicates' && Array.isArray(value)) {
        // Array of groups; each group is a set of equivalent exports.
        for (const group of value) {
          const members = (group || []).map(entryName).filter(Boolean).sort();
          if (members.length) set.add(`duplicate|${file}|${members.join(',')}`);
        }
        continue;
      }

      if (key === 'enumMembers' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [enumName, members] of Object.entries(value)) {
          for (const m of members || []) set.add(`enumMember|${file}|${enumName}|${entryName(m)}`);
        }
        continue;
      }

      if (Array.isArray(value)) {
        for (const e of value) {
          const n = entryName(e);
          if (n) set.add(`${key}|${file}|${n}`);
        }
      }
    }
  }
  return set;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return new Set(raw.findings || []);
}

function knipVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules', 'knip', 'package.json'), 'utf8'),
    );
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function prettyLine(fp) {
  const parts = fp.split('|');
  const cat = parts[0];
  if (cat === 'file') return `  [file]   ${parts[1]}`;
  return `  [${cat}]   ${parts[1]} → ${parts.slice(2).join(' · ')}`;
}

// ---- main -------------------------------------------------------------------

const current = fingerprints(getKnipReport());

if (UPDATE) {
  const findings = [...current].sort();
  const out = {
    $comment:
      'Baseline of KNOWN knip findings (dead-code backlog). The gate `npm run knip` ' +
      '(scripts/knip-gate.mjs) fails only on findings NOT listed here — i.e. NEW dead code. ' +
      'Captured with `knip --cache` for determinism. Regenerate after intentional changes ' +
      'with `npm run knip:baseline` and commit this file.',
    knipVersion: knipVersion(),
    generatedAt: new Date().toISOString().slice(0, 10),
    count: findings.length,
    findings,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ Wrote ${BASELINE_PATH} (${findings.length} known findings).`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(
    `✖ knip gate: no baseline at ${BASELINE_PATH}.\n` +
      '  Create it once with:  npm run knip:baseline   (then commit knip-baseline.json)',
  );
  process.exit(2);
}

const added = [...current].filter((fp) => !baseline.has(fp)).sort();

if (added.length > 0) {
  console.error(`✖ knip gate: ${added.length} NEW dead-code finding(s) not in the baseline:\n`);
  console.error(added.map(prettyLine).join('\n'));
  console.error(
    '\nThese were introduced (or newly orphaned) by this change. Fix them by removing the\n' +
      'dead code / wiring it up. If the finding is intentional and reviewed, refresh the\n' +
      'baseline:  npm run knip:baseline   (and commit knip-baseline.json).',
  );
  process.exit(1);
}

const removed = [...baseline].filter((fp) => !current.has(fp)).length;
console.log(
  `✓ knip gate: no new dead code. current=${current.size} baseline=${baseline.size}` +
    (removed > 0 ? ` (${removed} baselined finding(s) since cleaned — run npm run knip:baseline to shrink it).` : '.'),
);
process.exit(0);
