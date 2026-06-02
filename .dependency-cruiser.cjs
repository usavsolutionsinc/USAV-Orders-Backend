/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies make refactors painful.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'info',
      comment: 'Orphan modules are usually dead code.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack)\\.config\\.(js|cjs|mjs|ts|json)$',
          'next-env\\.d\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-test',
      comment: 'App code should not reach into test files.',
      severity: 'error',
      from: { pathNot: '\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$' },
      to: { path: '\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$' },
    },
    {
      name: 'no-deprecated-core',
      comment: "Don't use deprecated Node core modules.",
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'design-system-stays-generic',
      comment:
        'design-system must stay context-free: it should not import app/feature/domain code ' +
        '(components, hooks, lib, app, features, queries, services, contexts, data). ' +
        'Shared UI that needs app context belongs in components/ui instead. ' +
        'Currently `warn` because ~35 pre-existing violations exist (Icons barrel, a few ' +
        'mis-filed feature components); see COMPONENT_DEDUP_PLAN.md. Drive these to zero, ' +
        'then raise severity to `error`.',
      severity: 'warn',
      from: { path: '^src/design-system' },
      to: { path: '^src/(components|hooks|lib|app|features|queries|services|contexts|data)(/|$)' },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', '\\.next', 'dist', 'out', 'coverage', 'electron', 'scripts'],
    },
    exclude: {
      path: [
        '^node_modules',
        '^\\.next',
        '^dist',
        '^out',
        '^coverage',
        '^electron',
        '^public',
        '^scripts',
        '\\.test\\.(ts|tsx|js|jsx|mjs)$',
        '\\.spec\\.(ts|tsx|js|jsx|mjs)$',
      ],
    },
    includeOnly: '^src',
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      archi: {
        collapsePattern: '^(src/[^/]+)',
      },
      dot: {
        collapsePattern: '^src/(app|components|lib|domain)/[^/]+',
      },
    },
  },
};
