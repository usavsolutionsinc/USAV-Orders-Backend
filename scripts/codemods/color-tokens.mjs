#!/usr/bin/env node
/**
 * Codemod: raw color utility classes → semantic color tokens.
 *
 * Two independent passes:
 *
 * 1. HEX PASS (the original WS4 codemod): arbitrary `{util}-[#hex]` → semantic
 *    tokens / exact Tailwind classes. See MAP below.
 *
 * 2. NEUTRAL PASS (the "great token codemod", Wave 3 of the 2026-07-04 theme
 *    audit): raw neutral utilities (`bg-white`, `text-gray-900`,
 *    `border-slate-200`, …) → the semantic aliases bound to the theme
 *    registry's CSS variables (`bg-surface-card`, `text-text-default`,
 *    `border-border-soft`, …). Mappings are PARITY-SAFE by construction:
 *      - light values match the slate family exactly (gray/zinc are
 *        sub-perceptual shifts onto the same step), and
 *      - dark values match what the globals.css dark-scheme remap already
 *        rewrote each class to — so a converted file renders the same in both
 *        schemes, but now also themes correctly under mono/slate/any future
 *        palette.
 *    Variant prefixes (hover:, sm:, group-hover:, placeholder:, …) are
 *    preserved. Interactive `bg-*-50` washes map to `bg-surface-hover`
 *    (lighter-than-card on dark — mirrors the old remap) instead of the
 *    canvas token.
 *
 *    Deliberately NOT mapped (left to the dark-scheme remap / manual review):
 *      - opacity-modified classes (`bg-white/80`) — hex vars can't take
 *        Tailwind alpha modifiers;
 *      - `text-white`, saturated accent hues, gradient stops;
 *      - warm `stone`/`neutral` families (visible hue shift onto cool slate);
 *      - `text-*-300` and lighter (usually light-on-dark text);
 *      - `bg-*-300`+ (rare, judgment-call surfaces).
 *
 * Usage:
 *   node scripts/codemods/color-tokens.mjs           # dry run, both passes
 *   node scripts/codemods/color-tokens.mjs --apply   # write changes
 *   node scripts/codemods/color-tokens.mjs --hex-only | --neutrals-only
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const APPLY = process.argv.includes('--apply');
const HEX_ONLY = process.argv.includes('--hex-only');
const NEUTRALS_ONLY = process.argv.includes('--neutrals-only');

// ── Pass 1: arbitrary hex utilities ────────────────────────────────────────
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

// ── Pass 2: raw neutral utilities → theme-registry tokens ──────────────────

/** Neutral families treated as interchangeable steps of the slate ramp. */
const NEUTRAL_FAMILIES = new Set(['gray', 'slate', 'zinc', 'neutral']);

/**
 * Per step → token name per utility family (token names are the Tailwind
 * color keys from tailwind.config.ts; the utility prefix is re-applied).
 * A missing entry = deliberately unmapped.
 */
const STEP_MAP = {
  white: { bg: 'surface-card' },
  50: { bg: 'surface-canvas', border: 'border-hairline', divide: 'border-hairline', ring: 'border-hairline' },
  100: { bg: 'surface-sunken', border: 'border-hairline', divide: 'border-hairline', ring: 'border-hairline' },
  200: { bg: 'surface-strong', border: 'border-soft', divide: 'border-soft', ring: 'border-soft' },
  300: { bg: 'surface-strong', border: 'border-default', ring: 'border-default' },
  400: { text: 'text-faint', border: 'border-emphasis' },
  500: { text: 'text-soft' },
  600: { text: 'text-muted' },
  700: { text: 'text-muted' },
  800: { text: 'text-default' },
  900: { text: 'text-default' },
};

/** Variant prefixes that mean "interaction wash" for bg-*-50 → surface-hover. */
const INTERACTIVE_VARIANTS = /(?:^|:)(?:hover|focus|focus-within|focus-visible|active|group-hover|peer-hover)$/;

/**
 * Alpha (`/NN`) handling — token colors are Tailwind function colors backed by
 * color-mix(), so `bg-surface-card/90` etc. generate correctly. Conversion is
 * still selective:
 *  - `bg-white/50..95` are frosted SURFACES (sticky headers, overlays) —
 *    convert to `bg-surface-card/NN` (mirrors the dark remap exactly).
 *  - `bg-white/5..40` are GLASS HIGHLIGHTS on colored/dark fills —
 *    scheme-independent, keep raw.
 *  - Family-step classes (bg-gray-50/60, ring-slate-200/60, …) convert at any
 *    alpha — the remap already rewrote them per-alpha onto the same hues.
 */
const WHITE_SURFACE_ALPHAS = new Set(['50', '60', '70', '75', '80', '90', '95']);

// prefix chain (any `variant:` run) + utility + family/step (+ optional /NN),
// with token boundaries that reject longer identifiers and mid-token hits.
const NEUTRAL_RE =
  /(?<![\w/-])((?:[\w[\]&>~.-]+:)*)(bg|text|border(?:-[tbrlxyse])?|divide|ring)-(white|(?:gray|slate|zinc|neutral)-(?:50|[1-9]00))(?:\/(\d{1,3}))?(?![\w/-])/g;

function neutralReplacement(prefixChain, utility, colorPart, alpha) {
  let step;
  if (colorPart === 'white') {
    step = 'white';
    if (alpha !== undefined && !WHITE_SURFACE_ALPHAS.has(alpha)) return null; // glass highlight
  } else {
    const [family, rawStep] = colorPart.split('-');
    if (!NEUTRAL_FAMILIES.has(family)) return null;
    step = rawStep;
  }
  const familyKey = utility.startsWith('border') ? 'border' : utility;
  const stepTokens = STEP_MAP[step];
  if (!stepTokens) return null;
  let token = stepTokens[familyKey];
  if (!token) return null;
  // Interactive washes: hover:bg-*-50 is a "lighten me" affordance — route it
  // to the dedicated hover token (lighter than card on dark; ≈gray-50 on light).
  if (familyKey === 'bg' && step === '50' && alpha === undefined) {
    const variants = prefixChain.split(':').filter(Boolean);
    if (variants.some((v) => INTERACTIVE_VARIANTS.test(v))) token = 'surface-hover';
  }
  return `${prefixChain}${utility}-${token}${alpha !== undefined ? `/${alpha}` : ''}`;
}

// ── Walk + rewrite ──────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

/** Files the codemod must never touch. */
function isExcluded(rel) {
  return (
    rel.includes('.test.') || // guard/ratchet tests count these classes
    rel.startsWith('src/design-system/themes/') || // palette SoT (raw hex values)
    rel.startsWith('src/lib/migrations/')
  );
}

let files = 0;
let hexTotal = 0;
let neutralTotal = 0;
const perCombo = Object.fromEntries(combos.map((c) => [c, 0]));
const perNeutral = new Map();

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (isExcluded(rel)) continue;
  const src = readFileSync(file, 'utf8');
  let next = src;
  let count = 0;

  if (!NEUTRALS_ONLY) {
    // Lowercase only the hex inside each match so #A89F91 and #a89f91 both map.
    next = next.replace(
      // `(?<!\w)` only — must allow variant prefixes (`hover:`, `lg:`, `group-hover:`)
      // which end in `:`; we only reject a preceding word char (mid-token match).
      /(?<!\w)((?:text|bg|border|divide)-\[#[0-9a-fA-F]{3,8}\])/g,
      (m) => {
        const key = m.toLowerCase();
        if (key in MAP) {
          count += 1;
          hexTotal += 1;
          perCombo[key] += 1;
          return MAP[key];
        }
        return m;
      },
    );
  }

  if (!HEX_ONLY) {
    next = next.replace(NEUTRAL_RE, (m, prefixChain, utility, colorPart, alpha) => {
      const replacement = neutralReplacement(prefixChain, utility, colorPart, alpha);
      if (!replacement) return m;
      count += 1;
      neutralTotal += 1;
      const key = `${utility}-${colorPart} → ${replacement.slice(prefixChain.length)}`;
      perNeutral.set(key, (perNeutral.get(key) ?? 0) + 1);
      return replacement;
    });
  }

  if (count > 0) {
    files += 1;
    if (APPLY) writeFileSync(file, next);
    console.log(`${APPLY ? '✎' : '·'} ${rel} (${count})`);
  }
}

console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN (pass --apply)'));
console.log(`  files: ${files}   hex replacements: ${hexTotal}   neutral replacements: ${neutralTotal}`);
for (const c of combos) if (perCombo[c]) console.log(`    ${c.padEnd(20)} → ${MAP[c].padEnd(20)} ${perCombo[c]}`);
const sortedNeutral = [...perNeutral.entries()].sort((a, b) => b[1] - a[1]);
for (const [key, n] of sortedNeutral) console.log(`    ${key.padEnd(52)} ${n}`);
