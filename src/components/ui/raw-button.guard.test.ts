import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the Button-primitive migration (Cycle 1 / Workstream 2).
 *
 * The canonical <Button> (5 variants) and <IconButton> live in
 * src/design-system/primitives. ~1,491 hand-rolled `<button className="bg-…
 * px-… rounded-…">` still exist across the app — they drift on focus ring,
 * disabled state, touch target, and press feedback. This is a long migration,
 * not a one-shot codemod (each site has its own handlers/children), so the
 * guard RATCHETS: the raw-button count may only shrink, never grow. Every PR
 * that adds a styled button is nudged onto the primitive.
 *
 * Genuinely-needed raw <button>s (e.g. a Radix `asChild` trigger, a bespoke
 * widget the primitive can't express) are exempt: put `ds-raw-button` in a
 * comment on the same line or the line directly above. Use it sparingly.
 */

const SRC_ROOT = join(process.cwd(), 'src');

// Shrink-only baseline. LOWER as you migrate; never raise.
const RAW_BUTTON_BASELINE = 0;

const ESCAPE_MARKER = 'ds-raw-button';
// `\b` (not a `[\s/>]` lookahead) so a `<button` that opens a multi-line tag —
// attributes on the following lines, the common JSX style — is still counted.
// Does not match `</button>` (that's `</`, not `<b`).
const BUTTON_RE = /<button\b/g;

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

test('raw <button> count outside the design system does not grow (ratchet)', () => {
  let count = 0;
  for (const file of ALL_SOURCE_FILES) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    // The primitives themselves legitimately render <button>; guard files name it.
    if (rel.startsWith('design-system/') || rel.endsWith('.guard.test.ts')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    // Track whether we're inside a /* … */ (incl. JSX {/* … */}) block comment,
    // so a `<button` on a continuation line of a multi-line comment is skipped.
    let inBlock = false;
    lines.forEach((line, i) => {
      const wasInBlock = inBlock;
      // Update block-comment state from this line's last unmatched /* or */.
      const lastOpen = line.lastIndexOf('/*');
      const lastClose = line.lastIndexOf('*/');
      if (lastOpen > lastClose) inBlock = true;
      else if (lastClose > lastOpen) inBlock = false;

      const matches = line.match(BUTTON_RE);
      if (!matches) return;
      if (wasInBlock) return; // continuation line of a block comment
      // Skip false positives: `<button` inside a comment or a string literal —
      // documentation (e.g. "a <button> cannot nest a <button>") or selector/HTML
      // strings in .ts helpers, not real elements.
      const trimmed = line.trimStart();
      if (
        trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('/*') || trimmed.startsWith('{/*')
      ) return;
      const before = line.slice(0, line.indexOf('<button'));
      if (before.includes('//') || before.includes('/*')) return; // trailing comment
      if (/['"`]/.test(before) && /['"`]/.test(line.slice(line.indexOf('<button')))) return; // in a string
      // Exempt if the `ds-raw-button` marker is on the line above, on this line,
      // or within this button's opening tag — commonly placed in the className,
      // which can be several lines down (and arrow `=>` makes the closing `>`
      // unreliable to detect). Bound the search to before the NEXT `<button`.
      // up to 4 lines above (covers a marker comment placed above a `.map()` wrapper)
      let exempt = false;
      for (let j = Math.max(0, i - 4); j < i; j += 1) {
        if (lines[j].includes(ESCAPE_MARKER)) { exempt = true; break; }
      }
      for (let j = i; !exempt && j < lines.length && j < i + 25; j += 1) {
        if (j > i && /<button\b/.test(lines[j])) break; // next button — stop
        if (lines[j].includes(ESCAPE_MARKER)) { exempt = true; break; }
        if (lines[j].includes('</button>')) break;
      }
      if (!exempt) count += matches.length;
    });
  }
  assert.ok(
    count <= RAW_BUTTON_BASELINE,
    `Hand-rolled <button> count grew to ${count} (baseline ${RAW_BUTTON_BASELINE}). ` +
      `Use <Button>/<IconButton> from @/design-system/primitives. If a raw <button> ` +
      `is genuinely required, add a \`${ESCAPE_MARKER}\` comment on/above the line. ` +
      `Do not raise the baseline — LOWER it as you migrate.`,
  );
});

test('the deprecated DS PrimaryButton alias stays deleted (use <Button>)', () => {
  // The label-based DS adapter had 0 consumers and was removed. Guard against
  // re-introduction. (The unrelated local `PrimaryButton` in manuals/manual-crud
  // is a different component, imported from manual-crud-shared — not flagged.)
  const offenders: string[] = [];
  // a re-export or import of PrimaryButton from the design system
  const dsRe = /\bPrimaryButton\b[^;\n]*from\s*['"][^'"]*design-system|from\s*['"][^'"]*design-system[^;\n]*\bPrimaryButton\b|export\s+\*\s+from\s+['"]\.\/PrimaryButton['"]/;
  for (const file of ALL_SOURCE_FILES) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    if (rel.endsWith('.guard.test.ts')) continue;
    if (dsRe.test(readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    'The deprecated DS PrimaryButton is gone — use <Button> directly (children API, ' +
      'plus the `brand` variant). Do not re-add a design-system PrimaryButton export/import. ' +
      'Offending files:\n' + offenders.map((f) => `  - ${f}`).join('\n'),
  );
});
