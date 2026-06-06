import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import('eslint').Linter.FlatConfig[]} */
const eslintConfig = [
  // Base recommended rules
  js.configs.recommended,

  // Next.js recommended (brings in React, TypeScript, etc.)
  ...compat.extends('next/core-web-vitals'),

  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'apps/desktop/**', // build artifact tree
      'reports/**',
      '**/*.min.js',
      'src/lib/migrations/**',
      // Add any other generated or intentionally ignored dirs
    ],
  },

  {
    plugins: {
      'unused-imports': unusedImports,
    },

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },

    rules: {
      // === Unused code detection (the main reason for this config) ===
      // Replace the built-in rule with the plugin so it can auto-fix imports
      'no-unused-vars': 'off',
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

      // === Reasonable baseline for this large codebase ===
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',

      // React / Next practical rules
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'warn', // many existing disables; keep as warn for now

      // TypeScript-friendly relaxations (we use tsc for strictness)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports above

      // Import hygiene
      'import/no-duplicates': 'warn',

      // Project-specific: we have a lot of legacy dual paths — don't be too noisy yet
      'no-restricted-syntax': 'off',
    },
  },

  // Allow console in scripts and certain lib files
  {
    files: ['scripts/**/*', 'src/lib/pipeline/**/*', 'src/app/api/log-error/**/*'],
    rules: {
      'no-console': 'off',
    },
  },

  // Test files can be more relaxed
  {
    files: ['**/*.test.*', '**/*.spec.*', 'tests/**/*'],
    rules: {
      'no-console': 'off',
      'unused-imports/no-unused-vars': 'warn',
    },
  },
];

export default eslintConfig;
