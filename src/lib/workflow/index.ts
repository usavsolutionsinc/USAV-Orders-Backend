/**
 * Workflow engine — public API.
 *
 * Composes the production engine from its injectable parts and registers the
 * built-in node types. Routes and triggers should import from here.
 *
 *   import { advance, listNodeMeta, registerBuiltins } from '@/lib/workflow';
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { advanceItem, type AdvanceArgs, type AdvanceOutcome } from './advance';
import { getNode } from './registry';
import { createDrizzleStore } from './store';
import { emitWorkflowEvent } from './events';

let builtinsRegistered = false;

/**
 * Register the built-in node implementations. Idempotent. Phase C adds the
 * `./nodes/*` imports here; in Phase B the registry is intentionally empty
 * (the engine + tests don't depend on any concrete node).
 */
export function registerBuiltins(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  // Phase C: import './nodes/receiving.node', './nodes/inspection.node', etc.
  // Each module calls registerNode() as an import side-effect.
}

/** Advance one item through its active workflow using the production wiring. */
export async function advance(
  orgId: OrgId,
  args: Omit<AdvanceArgs, 'orgId'>,
): Promise<AdvanceOutcome> {
  registerBuiltins();
  return advanceItem(
    { store: createDrizzleStore(orgId), getNode, emit: emitWorkflowEvent },
    { orgId, ...args },
  );
}

export { listNodeMeta, listNodes, getNode, registerNode, hasNode } from './registry';
export { createDrizzleStore, enrollItem } from './store';
export { emitWorkflowEvent } from './events';
export { advanceItem } from './advance';
export type { AdvanceArgs, AdvanceOutcome } from './advance';
export * from './contract';
