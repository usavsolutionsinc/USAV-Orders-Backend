import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_DEFAULTS } from './registry';

/**
 * STABLE-CODE GUARD. A lifecycle `code` is the semantic identity the engine,
 * analytics, audit, and `reason_codes` overrides all key on — it must NEVER be
 * silently renamed/removed (a tenant relabels the *label*, never the code). This
 * test pins the exact code set per kind; adding/removing/renaming a code fails
 * here, forcing an intentional, reviewed change (mirrors "never rename audit
 * actions — dashboards key off them").
 *
 * To intentionally add a code: add it to the registry AND this snapshot in the
 * same commit. To rename a code: don't — add the new code and migrate, so
 * historical rows/overrides keyed on the old code keep resolving.
 */
const FROZEN_CODES: Record<string, string[]> = {
  unshipped: ['AWAITING_LABEL', 'PENDING', 'TESTED', 'PACKED_STAGED', 'BLOCKED'],
  outbound: ['PACKED_STAGED', 'SCANNED_OUT', 'IN_CUSTODY', 'DELIVERED', 'EXCEPTION', 'PROCESS_GAP', 'ORPHAN'],
};

test('label kinds match the frozen set (no silently added/removed vocabularies)', () => {
  assert.deepEqual(Object.keys(LABEL_DEFAULTS).sort(), Object.keys(FROZEN_CODES).sort());
});

test('every kind exposes exactly its frozen codes (no silent code drift)', () => {
  for (const [kind, codes] of Object.entries(FROZEN_CODES)) {
    assert.deepEqual(
      Object.keys(LABEL_DEFAULTS[kind as keyof typeof LABEL_DEFAULTS]).sort(),
      [...codes].sort(),
      `codes for kind '${kind}' drifted — update the registry AND this snapshot together`,
    );
  }
});

test('codes are SCREAMING_SNAKE_CASE constants, not display text', () => {
  for (const codes of Object.values(LABEL_DEFAULTS)) {
    for (const code of Object.keys(codes)) {
      assert.match(code, /^[A-Z][A-Z0-9_]*$/, `'${code}' is not a stable code constant`);
    }
  }
});
