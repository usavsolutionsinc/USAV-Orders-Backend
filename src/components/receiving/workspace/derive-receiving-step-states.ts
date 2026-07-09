export type ReceivingStepKey = 'scan' | 'photos' | 'condition' | 'serial' | 'print';

export type LinearStepState = 'done' | 'active' | 'pending';

export const RECEIVING_WORKFLOW_STEPS: ReadonlyArray<{
  key: ReceivingStepKey;
  label: string;
}> = [
  { key: 'scan', label: 'Scan' },
  { key: 'photos', label: 'Photos' },
  { key: 'condition', label: 'Condition' },
  { key: 'serial', label: 'Serial' },
  { key: 'print', label: 'Print' },
];

export interface DeriveReceivingStepStatesInput {
  /** Carton opened via scanner (true) vs sidebar rail click (false). */
  scanDriven?: boolean;
  photoCount: number;
  serialCount: number;
  quantityExpected: number;
  conditionSet: boolean;
  labelPrinted: boolean;
}

/**
 * Pure step-state derivation for the unbox progress stepper.
 *
 * Each step is done only when its own gate passes — never short-circuited by
 * workflow-complete status, which previously marked Condition/Print done while
 * Photos was still the active step on reopened lines.
 */
export function deriveReceivingStepFlags(input: DeriveReceivingStepStatesInput): Record<ReceivingStepKey, boolean> {
  const expected = input.quantityExpected ?? 0;
  const isSerialDone = expected > 0 ? input.serialCount >= expected : input.serialCount > 0;

  return {
    scan: input.scanDriven !== false,
    photos: input.photoCount > 0,
    condition: input.conditionSet,
    serial: isSerialDone,
    print: input.labelPrinted,
  };
}

/** Walk left-to-right: first incomplete step is active; a step is done only when its gate passes AND all prior steps are done. */
export function deriveReceivingStepStates(
  input: DeriveReceivingStepStatesInput,
): Record<ReceivingStepKey, LinearStepState> {
  const flags = deriveReceivingStepFlags(input);
  const states = Object.fromEntries(
    RECEIVING_WORKFLOW_STEPS.map(({ key }) => [key, 'pending' as LinearStepState]),
  ) as Record<ReceivingStepKey, LinearStepState>;

  let activeAssigned = false;
  let priorChainDone = true;
  for (const { key } of RECEIVING_WORKFLOW_STEPS) {
    const stepDone = priorChainDone && flags[key];
    if (stepDone) {
      states[key] = 'done';
    } else if (!activeAssigned) {
      states[key] = 'active';
      activeAssigned = true;
      priorChainDone = false;
    } else {
      priorChainDone = false;
    }
  }

  return states;
}

/** First active step key — used for step-aware UI (notes focus, photo peek, serial autofocus). */
export function activeReceivingStepKey(
  input: DeriveReceivingStepStatesInput,
): ReceivingStepKey | null {
  const states = deriveReceivingStepStates(input);
  const hit = RECEIVING_WORKFLOW_STEPS.find(({ key }) => states[key] === 'active');
  return hit?.key ?? null;
}
