/**
 * Workflow engine — event emitter.
 *
 * Bridges the engine's WorkflowEvent to the existing realtime layer. Reuses
 * publishDbEvent (the generic Ably db-row publisher), which already no-ops
 * gracefully when no Ably key is configured — so this is safe in dev/test.
 *
 * The ItemTracker overlay (Phase F) subscribes to item_workflow_state row
 * events to animate a unit moving across the canvas.
 */

import { publishDbEvent } from '@/lib/realtime/db-events';
import type { WorkflowEvent } from './contract';

export async function emitWorkflowEvent(orgId: string, event: WorkflowEvent): Promise<void> {
  await publishDbEvent({
    orgId,
    id: `wf-${event.serialUnitId}-${event.at}`,
    schema: 'public',
    table: 'item_workflow_state',
    pk: { id: event.serialUnitId, serial_unit_id: event.serialUnitId },
    op: 'UPDATE',
    payload: {
      nodeType: event.nodeType,
      output: event.output,
      workflowDefinitionId: event.workflowDefinitionId,
      // Source node instance id — lets the Live lens pulse the exact edge.
      nodeId: event.nodeId ?? null,
    },
    needsRefetch: true,
    createdAt: event.at,
  });
}
