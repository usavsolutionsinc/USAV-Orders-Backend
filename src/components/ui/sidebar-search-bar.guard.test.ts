import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Guards the sidebar-search standardization (see SidebarSearchBar.tsx).
 *
 * The size mismatch bug happened because the 40px search band and the input
 * `size` were applied by hand at ~20 different call sites, so they drifted
 * (28px vs 32px) across pages and modes. The fix is the <SidebarSearchBar>
 * component, which owns BOTH and exposes no `size` prop.
 *
 * These tests fail the moment someone reintroduces the drift.
 */

const SRC_ROOT = join(process.cwd(), 'src');
const SEARCH_BAND_TOKEN = 'sidebarHeaderSearchRowClass';

// The ONLY files allowed to mention the 40px search band: the token's own
// definition and the single component that wraps it. Everything else must go
// through <SidebarSearchBar>.
const BAND_ALLOWLIST = new Set([
  'components/layout/header-shell.ts',
  'components/ui/SidebarSearchBar.tsx',
  'components/ui/sidebar-search-bar.guard.test.ts', // this guard names the token
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SOURCE_FILES = walk(SRC_ROOT);

test('the 40px sidebar search band is referenced ONLY by SidebarSearchBar', () => {
  const offenders: string[] = [];
  for (const file of ALL_SOURCE_FILES) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/');
    if (BAND_ALLOWLIST.has(rel)) continue;
    if (readFileSync(file, 'utf8').includes(SEARCH_BAND_TOKEN)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `Do not hand-wrap the sidebar search band. Use <SidebarSearchBar> instead of ` +
      `\`<div className={${SEARCH_BAND_TOKEN}}><SearchBar .../></div>\`. Offending files:\n` +
      offenders.map((f) => `  - ${f}`).join('\n'),
  );
});

test('SidebarSearchBar does not expose a `size` prop (height is locked)', () => {
  const src = readFileSync(join(SRC_ROOT, 'components/ui/SidebarSearchBar.tsx'), 'utf8');
  // The whole point: sidebars cannot pass a size, so 28px/32px drift is impossible.
  assert.ok(
    src.includes("Omit<SearchBarProps, 'size'>"),
    'SidebarSearchBarProps must omit `size` so every sidebar header search is one height.',
  );
});
