import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';

/**
 * Minimal flat ESLint config focused on dead code hygiene.
 *
 * The primary goal is enabling `unused-imports` (the package was in devDeps
 * but had no effect because there was no eslint.config.* before).
 *
 * Full Next.js rules can be re-enabled later once we resolve compat layer
 * circular issues with eslint-config-next + ESLint 9 flat config.
 *
 * Usage:
 *   npx eslint src --max-warnings=10000
 *   npx eslint src --rule 'unused-imports/no-unused-imports:error' --fix
 *
 * `next lint` may still fall back to its defaults until this is polished.
 *
 * NOTE: do not paste a recursive glob into this block comment — the star-slash
 * sequence it contains closes the comment early and makes the whole config
 * unparseable (Node ESM "Unexpected token"). Describe paths in prose instead.
 */

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'apps/desktop/**',
      'reports/**',
      '**/*.min.js',
      'src/lib/migrations/**',
      'public/sw.js',
      'public/workbox-*.js',
      'public/fallback-*.js',
      'public/swe-worker-*.js',
    ],
  },

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    plugins: {
      'unused-imports': unusedImports,
    },

    rules: {
      // Core dead-code signal we care about for this effort
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Light baseline to avoid noise while cleaning
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
    },
  },

  {
    files: ['scripts/**/*', 'src/lib/pipeline/**/*'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Z-index scale guard ──────────────────────────────────────────────────
  // Stacking order is owned by the named scale in
  // `src/design-system/tokens/z-index.ts` (memory: z-index-scale-sot). New code
  // must consume a token — a `z-*` Tailwind class, `zIndex.*`, a CSS var, or the
  // <Layer>/<AnchoredLayer> primitives — never a raw global-scale number.
  //
  // These rules ban the *global-scale* offenders only: arbitrary `z-[NN]`
  // (2+ digits — Tailwind's own scale stops at z-50, so any multi-digit
  // arbitrary value is an overlay-layer number) and inline `zIndex: >= 50`
  // (the scale's overlay bands start at dropdown=50). Purely-local in-flow
  // stacking — `z-[1]` decorative masks, `whileDrag zIndex: 20` lifts — stays
  // native and is intentionally left alone. The one documented exception
  // (SerialCard's in-flow hover tooltip) carries an inline disable.
  //
  // ── Tenancy escape-hatch guard (merged into the same no-restricted-syntax) ─
  // `USAV_ORG_ID` / `transitionalUsavOrgId()` hardcode the dogfood org instead
  // of reading `ctx.organizationId` from the session. New code MUST NOT add
  // either. Both selectors live in THIS block (not a second one) because a
  // second block re-declaring no-restricted-syntax for the same files would
  // override — not merge with — this one, silently dropping the z-index guard.
  // The current known callers are allowlisted in the SEPARATE "rule off" block
  // immediately below (the burn-down list) — that disables only this rule for
  // those files, keeping them parsed + linted by every other rule. Delete each
  // allowlist entry as it is refactored so the debt can never regress.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/design-system/tokens/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/z-\\[\\d{2,}/]',
          message:
            'Arbitrary z-[NN] is banned. Use a named z-index token (z-panel/z-modal/…) or <Layer>/<AnchoredLayer>. See tokens/z-index.ts.',
        },
        {
          selector: 'TemplateElement[value.raw=/z-\\[\\d{2,}/]',
          message:
            'Arbitrary z-[NN] is banned. Use a named z-index token (z-panel/z-modal/…) or <Layer>/<AnchoredLayer>. See tokens/z-index.ts.',
        },
        {
          selector: "Property[key.name='zIndex'] > Literal[value>=50]",
          message:
            'Inline global zIndex literal is banned. Use zIndex.<token> from tokens/z-index.ts (or useZIndex()/<Layer>). Local in-flow lifts (< 50) are fine.',
        },
        {
          selector: "ImportSpecifier[imported.name='USAV_ORG_ID']",
          message:
            'Do not import USAV_ORG_ID in new code — derive the tenant from ctx.organizationId. See docs/tenancy/multi-tenancy-execution-plan.md §A3.',
        },
        {
          selector: "ImportSpecifier[imported.name='transitionalUsavOrgId']",
          message:
            'transitionalUsavOrgId() is deprecated migration debt — thread ctx.organizationId through instead. See docs/tenancy/multi-tenancy-execution-plan.md §A3.',
        },
        {
          selector: "CallExpression[callee.name='transitionalUsavOrgId']",
          message:
            'transitionalUsavOrgId() is deprecated migration debt — thread ctx.organizationId through instead. See docs/tenancy/multi-tenancy-execution-plan.md §A3.',
        },
      ],
    },
  },

  // ── Tenancy burn-down allowlist ──────────────────────────────────────────
  // The current known `USAV_ORG_ID` / `transitionalUsavOrgId()` callers. This
  // block turns OFF no-restricted-syntax ONLY for these files (they stay parsed
  // by tsParser from the block above and linted by every other rule). As each
  // file is refactored to thread ctx.organizationId, DELETE its entry here so
  // the guard starts enforcing it. When this list is empty, the debt is paid.
  // (z-index does not apply to these backend files, so disabling the whole rule
  // here is harmless.)
  {
    files: [
      'src/lib/tenancy/**/*.{ts,tsx}',
      'src/lib/ebay/browse-client.ts',
      'src/lib/integrations/credentials.ts',
      'src/app/api/auth/staff-picker/route.ts',
      'src/app/api/cron/zoho/orders-ingest-drain/route.ts',
      'src/lib/pipeline/orchestrator.ts',
      'src/lib/pipeline/collect.ts',
      'src/lib/zoho/fulfillment-sync.ts',
      'src/lib/realtime/publish.ts',
      'src/lib/jobs/google-sheets-transfer-orders.ts',
      'src/services/OrderSyncService.ts',
      // D1 (Ably org-namespacing) session-less integration publishers — these
      // carrier/Square/shipping-sync paths have no request org yet (single-tenant
      // USAV today); they resolve org from the row's organization_id post-Phase-B.
      'src/lib/shipping/publish-on-status-change.ts',
      'src/lib/neon/stock-ledger-helpers.ts',
      'src/app/api/webhooks/square/route.ts',
      'src/app/api/webhooks/ups/route.ts',
      'src/app/api/ecwid/transfer-orders/route.ts',
      'src/app/api/google-sheets/transfer-orders/route.ts',
      'src/app/api/shipping/track/sync-one/route.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  {
    files: ['**/*.test.*', '**/*.spec.*', 'tests/**/*'],
    rules: {
      'no-console': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': 'warn',
      'no-restricted-syntax': 'off',
    },
  },
];
