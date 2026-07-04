import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the raw-neutral → semantic-token migration (2026-07-04 theme audit,
 * Wave 3 — the "great token codemod").
 *
 * Neutral chrome comes from the theme registry's semantic aliases
 * (`bg-surface-card`, `text-text-default`, `border-border-soft`, …, bound to
 * `--ds-color-*` vars in src/design-system/themes/registry.ts) — never raw
 * neutral Tailwind utilities (`bg-white`, `text-gray-900`, `border-slate-200`).
 * Raw neutrals bypass the theme registry: they only look right in light mode
 * and force the dark-scheme remap (globals.css) to grow forever.
 *
 * ~10,900 raw neutrals were converted by scripts/codemods/color-tokens.mjs.
 * The remainder is deliberate:
 *   - alpha-modified classes (`bg-white/90`) — hex-var tokens can't take
 *     Tailwind alpha modifiers, so these stay raw until tokens move to
 *     RGB-triple vars;
 *   - deliberate dark chrome (camera UI, inverted pills) and light text on it;
 *   - focus-emphasis neutral ramps and 400-step underline affordances that
 *     have no token yet.
 *
 * This guard RATCHETS the count — it may only shrink. A genuinely-needed raw
 * neutral is exempt with a `ds-allow-raw-neutral` comment on the same line or
 * the line above. `text-white` is out of scope (text on saturated fills is
 * scheme-independent), as are chart/dataviz hex arrays.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Shrink-only. LOWER as the deliberate remainder gains tokens; never raise.
// 2026-07-04: 1151, down from ~12,100 before the Wave-3 codemod. The bulk of
// the remainder is alpha washes (bg-white/10, bg-gray-50/60), deliberate dark
// chrome (bg-gray-900, text-gray-300 on it), and 300-step decorative fills.
// 2026-07-04b: 454 after the inverse-chrome sweep (bg-surface-inverse /
// text-text-inverse-soft / border-border-inverse / border-border-strong /
// ring-surface-inverse fill-matched rings / text-text-faint adoption).
// Remainder = alpha scrims + glass, camera/media UI, print zones, staff/tone
// color registries, and chart constants — all deliberate.
const RAW_NEUTRAL_BASELINE = 454;

const ESCAPE_MARKER = 'ds-allow-raw-neutral';
const RAW_NEUTRAL_RE =
  /(?<![\w/-])(?:[\w-]+:)*(?:bg|text|border(?:-[tbrlxyse])?|divide|ring)-(?:white|black|(?:gray|slate|zinc|stone|neutral)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;

/** Deliberately out of scope (scheme-independent vocabulary). */
const OUT_OF_SCOPE = /(?:text|ring|border(?:-[tbrlxyse])?|divide)-white|(?:text|ring)-black/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry)) && !entry.endsWith('.guard.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const ALL_SOURCE_FILES = walk(SRC_ROOT);

test('raw neutral utility classes do not grow (ratchet → theme-registry tokens)', () => {
  let count = 0;
  const offenders = new Map<string, number>();
  for (const file of ALL_SOURCE_FILES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const matches = line.match(RAW_NEUTRAL_RE);
      if (!matches) return;
      if (line.includes(ESCAPE_MARKER) || (i > 0 && lines[i - 1].includes(ESCAPE_MARKER))) return;
      for (const m of matches) {
        if (OUT_OF_SCOPE.test(m)) continue;
        count += 1;
        offenders.set(m, (offenders.get(m) ?? 0) + 1);
      }
    });
  }
  const top = [...offenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  assert.ok(
    count <= RAW_NEUTRAL_BASELINE,
    `Raw neutral utility classes grew to ${count} (baseline ${RAW_NEUTRAL_BASELINE}). ` +
      `Use the theme-registry tokens instead: bg-surface-card/canvas/sunken/hover/strong, ` +
      `text-text-default/muted/soft/faint, border-border-hairline/soft/default (also as ring-/divide-). ` +
      `If a raw neutral is genuinely needed (alpha wash, deliberate dark chrome), add a ` +
      `\`${ESCAPE_MARKER}\` comment. Do not raise the baseline — LOWER it. ` +
      `Top offenders: ${top.map(([k, v]) => `${k}×${v}`).join(', ')}`,
  );
});
