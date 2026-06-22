import type { useTestingLineController } from '@/components/tech/hooks/useTestingLineController';

/**
 * The testing-line controller bag, threaded as one prop to the panel's
 * presentational sections. `import type` keeps this erased at runtime.
 */
export type TestingController = ReturnType<typeof useTestingLineController>;
