'use client';

import type { EntityType, WorkStatus } from '@/components/work-orders/types';

export interface SaveWorkOrderParams {
  entityType: EntityType;
  entityId: number;
  assignedTechId: number | null;
  assignedPackerId?: number | null;
  status: WorkStatus;
  priority: number;
  deadlineAt: string | null;
  notes?: string | null;
}

export async function saveWorkOrder(params: SaveWorkOrderParams) {
  const body: Record<string, unknown> = {
    entityType: params.entityType,
    entityId: params.entityId,
    assignedTechId: params.assignedTechId,
    status: params.status,
    priority: params.priority,
    deadlineAt: params.deadlineAt,
  };

  if (params.assignedPackerId !== undefined) {
    body.assignedPackerId = params.assignedPackerId;
  }
  if (params.notes !== undefined) {
    body.notes = params.notes;
  }

  const res = await fetch('/api/work-orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(String(payload?.details || payload?.error || 'Failed to save work order'));
  }
}
