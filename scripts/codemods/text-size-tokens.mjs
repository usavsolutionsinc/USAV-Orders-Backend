#!/usr/bin/env node
/**
 * Codemod: arbitrary `text-[Npx]` → named font-size tokens.
 *
 * Tailwind already defines a compact sub-12px scale in `tailwind.config.ts`
 * (theme.fontSize): mini=8, eyebrow=9, micro=10, caption=11, label=12. Hundreds
 * of call sites hand-rolled the raw `text-[10px]` equivalents instead, which
 * drift and bypass the scale. This rewrites the 1:1 mappable sizes onto the
 * tokens. The `cn()` helper now teaches tailwind-merge about these tokens
 * (src/utils/_cn.ts), so they survive conflict resolution.
 *
 * Only the purpose-built compact scale (8–12px) is auto-converted — those are
 * high-volume and their tokens carry the intended tight line-heights. Body /
 * heading sizes (13px+) are left for manual review (line-height matters more
 * there and volume is low).
 *
 * Usage:
 *   node scripts/codemods/text-size-tokens.mjs          # dry run (default)
 *   node scripts/codemods/text-size-tokens.mjs --apply  # write changes
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const APPLY = process.argv.includes('--apply');

// 1:1 px → token. Keep in sync with tailwind.config.ts theme.fontSize.
const MAP = { 8: 'mini', 9: 'eyebrow', 10: 'micro', 11: 'caption', 12: 'label' };

// Match `text-[Npx]` only when it is a standalone class (not a substring of a
// longer identifier). Allows `:`/`-`-joined prefixes like `sm:`, `peer-focus:`.
const SIZES = Object.keys(MAP).join('|');
const RE = new RegExp(`(?<![A-Za-z0-9])text-\\[(${SIZES})px\\]`, 'g');

// Files the codemod must never rewrite (they document the raw strings on purpose).
const SKIP = new Set([
  'scripts/codemods/text-size-tokens.mjs',
  'components/ui/typography-tokens.guard.test.ts',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

let filesChanged = 0;
let totalReplacements = 0;
const perSize = Object.fromEntries(Object.keys(MAP).map((k) => [k, 0]));

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (SKIP.has(relative(SRC, file).split('\\').join('/'))) continue;
  const src = readFileSync(file, 'utf8');
  let count = 0;
  // Replace per-line so we can skip pure-comment lines — JSDoc/`//` lines that
  // document the raw `text-[10px]` strings on purpose must not be rewritten.
  const next = src
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return line;
      }
      return line.replace(RE, (_m, px) => {
        count += 1;
        perSize[px] += 1;
        return `text-${MAP[px]}`;
      });
    })
    .join('\n');
  if (count > 0) {
    filesChanged += 1;
    totalReplacements += count;
    if (APPLY) writeFileSync(file, next);
    console.log(`${APPLY ? '✎' : '·'} ${rel} (${count})`);
  }
}

console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN (pass --apply to write)'));
console.log(`  files:        ${filesChanged}`);
console.log(`  replacements: ${totalReplacements}`);
for (const [px, token] of Object.entries(MAP)) {
  console.log(`    text-[${px}px] → text-${token.padEnd(8)} ${perSize[px]}`);
}
