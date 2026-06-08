/**
 * Domain types for the FBA "condense FNSKU" operation.
 *
 * When an FNSKU is added to a plan it may be condensed into an existing line,
 * increment an existing line's qty, or create a new line — see
 * `domain/fba/condense-fnsku.ts`, the only consumer of these types.
 */

export type CondenseAction = 'condensed' | 'incremented' | 'created';

export interface AddFnskuResult {
  action: CondenseAction;
  itemId: number;
  newQty: number;
  /** Set when action is 'condensed' — the plan the item was moved from. */
  fromPlanId?: number;
}
