import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { test } from 'node:test';

/**
 * W0 freeze guard for the Class-D reason-codes migration
 * (docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md §4 "W0").
 *
 * Reason / disposition vocabularies belong in tenant `reason_codes` rows, read
 * through getActiveReasonCodes — NOT as hardcoded TS arrays scattered across
 * components + lib (substitution, short-pick, receiving-exception, repair, …).
 * This guard RATCHETS: the count of hardcoded reason-array declarations (an
 * UPPER_SNAKE const ending in REASON(S) / REASON_OPTIONS / EXCEPTION_CODES /
 * DISPOSITION(S), assigned an array literal) may only SHRINK, never grow. As
 * each vocabulary migrates (D1/D2), delete its array and LOWER the baseline.
 *
 * Exempt: the built-in registry SoT (substitution-reasons.ts) — the one
 * sanctioned home, seeded into reason_codes. A genuinely-required literal
 * elsewhere: put `reason-codes-hardcoded` in a comment on/above the declaration.
 * Use sparingly.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Shrink-only baseline. Every reason vocabulary now lives in a registry (ALLOWED)
// or reason_codes — zero remain inline in a component. Keep it at 0.
const REASON_ARRAY_BASELINE = 0;

const ESCAPE_MARKER = 'reason-codes-hardcoded';

// The per-vocabulary registries — each is the single allowed home for a reason
// vocabulary array. Two kinds: DESCRIPTIVE registries (substitution/short-pick/
// repair) that are the built-in fallback + seed source for tenant-customizable
// reason_codes; and SYSTEM registries (receiving-exception, the LLM disposition
// enum) whose codes are behavior-bearing / DB-enum-bound and stay the engine's
// branch SoT (seeded into reason_codes only for visibility). A vocabulary lives
// in exactly ONE of these — never inline in a component or scattered across lib.
const ALLOWED = new Set([
  'lib/fulfillment/substitution-reasons.ts',
  'lib/picking/short-pick-reasons.ts',
  'lib/repair/repair-failure-reasons.ts',
  'lib/receiving/exception-codes.ts',
  'lib/receiving-disposition-classify-llm.ts',
  'lib/sku/sku-stock-reasons.ts',
]);

// An UPPER_SNAKE identifier assigned an array literal (`NAME … = [`). We capture
// any such name, then keep only reason/disposition-suffixed ones — so unrelated
// const arrays (SEED_PLATFORMS, SHELF_ORDER, …) never trip the gate.
const DECL_RE = /\b([A-Z][A-Z0-9_]*)\b[^\n=]*=\s*\[/g;
const REASON_SUFFIX = /(REASONS?|REASON_OPTIONS|EXCEPTION_CODES|DISPOSITIONS?)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const ALL_SOURCE_FILES = walk(SRC_ROOT);

test('hardcoded reason/disposition array count does not grow (ratchet)', () => {
  let count = 0;
  const hits: string[] = [];
  for (const file of ALL_SOURCE_FILES) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    if (ALLOWED.has(rel) || rel.endsWith('.guard.test.ts')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      let m: RegExpExecArray | null;
      DECL_RE.lastIndex = 0;
      while ((m = DECL_RE.exec(line))) {
        if (!REASON_SUFFIX.test(m[1])) continue;
        const exempt =
          line.includes(ESCAPE_MARKER) || (i > 0 && lines[i - 1].includes(ESCAPE_MARKER));
        if (!exempt) {
          count += 1;
          hits.push(`${rel}:${i + 1}  ${m[1]}`);
        }
      }
    });
  }
  assert.ok(
    count <= REASON_ARRAY_BASELINE,
    `Hardcoded reason/disposition arrays grew to ${count} (baseline ${REASON_ARRAY_BASELINE}).\n` +
      hits.map((h) => `  - ${h}`).join('\n') +
      `\nReason vocabularies belong in tenant reason_codes rows (read via getActiveReasonCodes); ` +
      `see docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md §3.D / D1. ` +
      `If a literal is genuinely required, add a \`${ESCAPE_MARKER}\` comment on/above it. ` +
      `Do not raise the baseline — LOWER it as you migrate.`,
  );
});
