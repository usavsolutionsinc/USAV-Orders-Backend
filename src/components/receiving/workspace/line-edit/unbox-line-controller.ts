import type { useUnboxLineController } from './hooks/useUnboxLineController';

/**
 * The flat state/handler bag returned by {@link useUnboxLineController}. The
 * LineEditPanel section components take this whole object as one prop (rather
 * than threading ~18 individual values) since the controller is the single
 * source of truth for the entire unbox/triage panel family.
 */
export type UnboxLineController = ReturnType<typeof useUnboxLineController>;
