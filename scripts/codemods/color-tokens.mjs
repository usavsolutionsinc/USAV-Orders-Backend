#!/usr/bin/env node
/**
 * Codemod: arbitrary `{util}-[#hex]` → semantic color tokens / exact Tailwind.
 *
 * Two safe categories only (per the WS4 decision — normalize the operations
 * warm/tan palette onto existing tokens; accept a slight shift):
 *   1. Warm palette  → semantic tokens (text-text-*, bg-surface-*, border-border-*).
 *   2. Standard Tailwind colors written as hex → their exact class (zero shift).
 *
 * Deliberately NOT mapped (left for manual review / the hex ratchet guard):
 *   - custom accents with no token: #e07a5f (coral), #6b9080 (sage)
 *   - intentional dark code-surface fills: #0a0a0b, #15151b, #0b0b0f
 *   - mid-tan fills used as backgrounds: #c4baa8, dark #2d2a26 bg
 * Mapping is per-(utility,hex) because a warm hex means a different role as
 * text vs bg vs border.
 *
 * Usage: node scripts/codemods/color-tokens.mjs [--apply]   (dry run default)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const APPLY = process.argv.includes('--apply');

// Full `{utility}-[#hex]` (lowercased) → replacement class.
const MAP = {
  // ── warm/tan text → semantic text tokens ──
  'text-[#2d2a26]': 'text-text-default',
  'text-[#4a4239]': 'text-text-default',
  'text-[#5c5548]': 'text-text-muted',
  'text-[#6b6356]': 'text-text-muted',
  'text-[#a89f91]': 'text-text-muted',
  'text-[#c4baa8]': 'text-text-soft',
  // ── warm surfaces → surface tokens ──
  'bg-[#fbfbfa]': 'bg-surface-card',
  'bg-[#fafaf8]': 'bg-surface-card',
  'bg-[#fafafa]': 'bg-surface-card',
  'bg-[#f5f3ef]': 'bg-surface-canvas',
  'bg-[#f0ede8]': 'bg-surface-canvas',
  'bg-[#e8e4dd]': 'bg-surface-sunken',
  // ── warm hairlines → border/divide tokens ──
  'border-[#f0ede8]': 'border-border-soft',
  'border-[#e8e4dd]': 'border-border-soft',
  'border-[#f5f3ef]': 'border-border-soft',
  'divide-[#f5f3ef]': 'divide-border-soft',
  'divide-[#f0ede8]': 'divide-border-soft',
  // ── standard Tailwind colors written as hex → exact class (zero shift) ──
  'bg-[#f59e0b]': 'bg-amber-500',
  'text-[#d97706]': 'text-amber-600',
};

const combos = Object.keys(MAP);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

let files = 0;
let total = 0;
const perCombo = Object.fromEntries(combos.map((c) => [c, 0]));

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const src = readFileSync(file, 'utf8');
  let count = 0;
  // Lowercase only the hex inside each match so #A89F91 and #a89f91 both map.
  const next = src.replace(
    // `(?<!\w)` only — must allow variant prefixes (`hover:`, `lg:`, `group-hover:`)
    // which end in `:`; we only reject a preceding word char (mid-token match).
    /(?<!\w)((?:text|bg|border|divide)-\[#[0-9a-fA-F]{3,8}\])/g,
    (m) => {
      const key = m.toLowerCase();
      if (key in MAP) {
        count += 1;
        perCombo[key] += 1;
        return MAP[key];
      }
      return m;
    },
  );
  if (count > 0) {
    files += 1;
    total += count;
    if (APPLY) writeFileSync(file, next);
    console.log(`${APPLY ? '✎' : '·'} ${rel} (${count})`);
  }
}

console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN (pass --apply)'));
console.log(`  files: ${files}   replacements: ${total}`);
for (const c of combos) if (perCombo[c]) console.log(`    ${c.padEnd(20)} → ${MAP[c].padEnd(20)} ${perCombo[c]}`);
