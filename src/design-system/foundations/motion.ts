export const motionDurations = {
  instant: '0ms',
  fast: '150ms',
  normal: '220ms',
  slow: '320ms',
  slower: '480ms',
} as const;

export const motionEasings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  emphasized: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

export type MotionDurations = typeof motionDurations;
