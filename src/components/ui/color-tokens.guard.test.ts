import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the color-token standardization (Cycle 1 / Workstream 4).
 *
 * Color comes from semantic tokens (src/design-system/tokens/colors/semantic.ts,
 * surfaced as `text-text-*`, `bg-surface-*`, `border-border-*`) or the Tailwind
 * palette — never a hardcoded hex in a utility class. The operations dashboard's
 * bespoke warm/tan palette (#a89f91, #2d2a26, #f0ede8, …) was normalized onto
 * the semantic tokens; ~228 arbitrary-hex utilities were removed.
 *
 * The remaining few are genuinely custom (coral #e07a5f, sage #6b9080) or
 * intentional dark code-surfaces (#0a0a0b) with no token yet. The guard RATCHETS
 * arbitrary-hex UTILITY classes (`text-[#…]`, `bg-[#…]`, …) — it may only shrink.
 * (Inline `style={{ color: '#…' }}` and chart color arrays are out of scope —
 * data-viz legitimately needs raw hex.) A genuinely-needed hex utility is exempt
 * with a `ds-allow-hex` comment on the same line or the line above.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Shrink-only. LOWER as customs get real tokens; never raise.
const HEX_UTILITY_BASELINE = 24;

const ESCAPE_MARKER = 'ds-allow-hex';
const HEX_UTILITY_RE =
  /\b(?:text|bg|border|ring|divide|from|to|via|fill|stroke|outline|shadow|caret|accent|decoration)-\[#[0-9a-fA-F]{3,8}\]/g;

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

test('arbitrary-hex utility classes do not grow (ratchet → semantic tokens)', () => {
  let count = 0;
  const offenders: string[] = [];
  for (const file of ALL_SOURCE_FILES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const matches = line.match(HEX_UTILITY_RE);
      if (!matches) return;
      if (line.includes(ESCAPE_MARKER) || (i > 0 && lines[i - 1].includes(ESCAPE_MARKER))) return;
      count += matches.length;
      offenders.push(...matches);
    });
  }
  assert.ok(
    count <= HEX_UTILITY_BASELINE,
    `Hardcoded-hex utility classes grew to ${count} (baseline ${HEX_UTILITY_BASELINE}). ` +
      `Use semantic tokens (text-text-*, bg-surface-*, border-border-*) or a Tailwind ` +
      `shade. If a custom color is genuinely needed, add a token or a \`${ESCAPE_MARKER}\` ` +
      `comment. Do not raise the baseline — LOWER it. New offenders include: ` +
      [...new Set(offenders)].slice(0, 8).join(', '),
  );
});
