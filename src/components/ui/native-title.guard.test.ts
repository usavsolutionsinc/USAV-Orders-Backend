import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the tooltip migration (Cycle 1 / Workstream 3).
 *
 * `HoverTooltip` (src/components/ui/HoverTooltip.tsx) is the house tooltip —
 * body-portalled, viewport-clamped, styled, instant. The native `title=`
 * attribute is slow, unstyled, and clipped by scroll containers. ~485 native
 * `title=` remain across the app.
 *
 * Only NATIVE elements are flagged: a `title=` on a lowercase tag (`<button>`,
 * `<div>`, `<span>`, `<a>`, `motion.button`, …) is a native browser tooltip and
 * a violation. A `title=` on a Capitalized COMPONENT (`<PageHeader title=…>`) is
 * that component's own prop — legitimate API, never flagged.
 *
 * Like buttons, tooltip migration is NOT a blind codemod: wrapping an element in
 * <HoverTooltip>'s span can shift flex/grid layout, so each conversion needs a
 * look. The guard therefore RATCHETS native `title=` — it may only shrink. A
 * genuinely-needed native title (e.g. an OS-level tooltip on a truncated cell)
 * is exempt with a `ds-allow-title` comment on the same line or the line above.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Shrink-only. LOWER as you migrate to HoverTooltip; never raise.
const NATIVE_TITLE_BASELINE = 42;

const ESCAPE_MARKER = 'ds-allow-title';
// A native lowercase opening tag, then attrs (crossing newlines / arrow-fn `>`),
// then `title=`. `[^<]` stops at the next element so it can't bridge two tags.
const NATIVE_TITLE_RE = /<([a-z][\w.]*)\b[^<]*?\btitle=/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // title= is a JSX attribute — only .tsx. (Conveniently excludes this .ts guard.)
    else if (extname(entry) === '.tsx') out.push(full);
  }
  return out;
}

const ALL_TSX = walk(SRC_ROOT);

function lineOf(text: string, index: number): { line: string; prev: string } {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  const line = text.slice(start, end < 0 ? text.length : end);
  const prevStart = text.lastIndexOf('\n', start - 2) + 1;
  const prev = start > 0 ? text.slice(prevStart, start - 1) : '';
  return { line, prev };
}

test('native-element title= count does not grow (ratchet → HoverTooltip)', () => {
  let count = 0;
  for (const file of ALL_TSX) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(NATIVE_TITLE_RE)) {
      const { line, prev } = lineOf(text, m.index ?? 0);
      if (line.includes(ESCAPE_MARKER) || prev.includes(ESCAPE_MARKER)) continue;
      count += 1;
    }
  }
  assert.ok(
    count <= NATIVE_TITLE_BASELINE,
    `Native \`title=\` count grew to ${count} (baseline ${NATIVE_TITLE_BASELINE}). ` +
      `Use <HoverTooltip label="…"> from @/components/ui/HoverTooltip instead of a ` +
      `native title attribute. If an OS-level title is genuinely wanted, add a ` +
      `\`${ESCAPE_MARKER}\` comment on/above the line. Do not raise the baseline — LOWER it.`,
  );
});

test('HoverTooltip remains the single house tooltip primitive', () => {
  const defPath = join(SRC_ROOT, 'components/ui/HoverTooltip.tsx');
  const src = readFileSync(defPath, 'utf8');
  assert.ok(
    src.includes('export function HoverTooltip') && src.includes('role="tooltip"'),
    'HoverTooltip must remain the portal-positioned house tooltip primitive.',
  );
});
