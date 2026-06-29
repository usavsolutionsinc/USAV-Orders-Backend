import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the typography-token standardization (Cycle 1 / Workstream 1).
 *
 * `tailwind.config.ts` defines a compact sub-12px scale — text-mini (8),
 * text-eyebrow (9), text-micro (10), text-caption (11), text-label (12).
 * Hundreds of call sites had hand-rolled the raw `text-[10px]` equivalents
 * instead, which drift and bypass the scale. `cn()` (src/utils/_cn.ts) now
 * teaches tailwind-merge about these tokens so they survive conflict
 * resolution, and `scripts/codemods/text-size-tokens.mjs` converted the
 * existing call sites.
 *
 * These tests fail the moment someone reintroduces a raw arbitrary px size
 * that has a token, or lets the un-tokenized long tail grow.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Raw `text-[Npx]` sizes that have a named token — these must NEVER appear.
const TOKEN_BY_PX: Record<number, string> = {
  8: 'text-mini',
  9: 'text-eyebrow',
  10: 'text-micro',
  11: 'text-caption',
  12: 'text-label',
};

// Ratchet for the un-tokenized long tail (13px, 15px, 20px, …). It may only
// shrink. Lower this number as those sizes get normalized onto the scale; never
// raise it. A new arbitrary size in this range fails the build until tokenized.
const LONG_TAIL_BASELINE = 111;

// Match `text-[Npx]` only as a standalone class (mirrors the codemod regex):
// allows `:`/`-`-joined prefixes, rejects substrings of longer identifiers.
const ARBITRARY_PX_RE = /(?<![A-Za-z0-9])text-\[(\d+)px\]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

// A pure-comment line (JSDoc `*`, `//`, `/*`) may reference the raw strings to
// document them — those are not real class usages. Same predicate the codemod
// uses to avoid rewriting docs.
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

const ALL_SOURCE_FILES = walk(SRC_ROOT);

test('no raw text-[Npx] for a size that has a named token', () => {
  const offenders: string[] = [];
  for (const file of ALL_SOURCE_FILES) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const m of line.matchAll(ARBITRARY_PX_RE)) {
        const px = Number(m[1]);
        if (px in TOKEN_BY_PX) {
          offenders.push(`  ${rel}:${i + 1}  text-[${px}px] → ${TOKEN_BY_PX[px]}`);
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'Use the named font-size tokens, not raw arbitrary px. The compact scale ' +
      '(text-mini/eyebrow/micro/caption/label) lives in tailwind.config.ts and ' +
      'is conflict-safe through cn(). Offending sites:\n' + offenders.join('\n'),
  );
});

test('the un-tokenized arbitrary-px long tail does not grow (ratchet)', () => {
  let count = 0;
  for (const file of ALL_SOURCE_FILES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (isCommentLine(line)) continue;
      for (const m of line.matchAll(ARBITRARY_PX_RE)) {
        if (!(Number(m[1]) in TOKEN_BY_PX)) count += 1;
      }
    }
  }
  assert.ok(
    count <= LONG_TAIL_BASELINE,
    `Arbitrary text-[Npx] sizes without a token grew to ${count} (baseline ` +
      `${LONG_TAIL_BASELINE}). Either reuse the named scale or, if a new size is ` +
      `genuinely needed, add a token in tailwind.config.ts. Do not raise the ` +
      `baseline. (As you normalize existing sites, LOWER it.)`,
  );
});

test('cn() registers the custom font-size tokens with tailwind-merge (keystone)', () => {
  const src = readFileSync(join(SRC_ROOT, 'utils/_cn.ts'), 'utf8');
  // Without this, twMerge mis-groups e.g. `text-micro` as a text COLOR and drops
  // it when a real text color is also present — the bug that drove the raw
  // `text-[10px]` workarounds in the first place.
  assert.ok(
    src.includes('extendTailwindMerge') && src.includes("'font-size'"),
    "cn() must extend tailwind-merge's 'font-size' group with the custom tokens " +
      '(mini/eyebrow/micro/caption/label) so they survive conflict resolution.',
  );
  for (const token of ['mini', 'eyebrow', 'micro', 'caption', 'label']) {
    assert.ok(
      src.includes(`'${token}'`),
      `cn() must register the '${token}' font-size token with tailwind-merge.`,
    );
  }
});
