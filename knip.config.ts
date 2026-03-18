import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/app/**/*.ts',
    'src/app/**/*.tsx',
    'electron/main.js',
    'server/index.js',
  ],
  project: ['src/**/*.{ts,tsx}'],
  ignore: ['src/**/*.test.*', 'src/types/**', 'src/lib/migrations/**'],
  ignoreDependencies: ['@types/*'],
};

export default config;
