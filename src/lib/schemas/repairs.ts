import { z } from 'zod';

/**
 * Validation for per-serial repair records (unit_repairs).
 * See docs/condition-grading-repair-qc-plan.md §4.5.
 */

const trimmed = z.string().trim();

export const REPAIR_OPEN_STATUSES = ['pending', 'in_progress'] as const;
export const REPAIR_ALL_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'scrapped'] as const;

const RepairPart = z.object({
  sku: trimmed.max(80).optional(),
  qty: z.number().int().positive().optional(),
  cost_cents: z.number().int().nonnegative().optional(),
  note: trimmed.max(200).optional(),
});

export const RepairCreateBody = z.object({
  summary: trimmed.min(1).max(500),
  status: z.enum(REPAIR_OPEN_STATUSES).optional(),
  failureModeIds: z.array(z.coerce.number().int().positive()).max(50).optional(),
  rmaId: z.coerce.number().int().positive().nullish(),
  repairServiceId: z.coerce.number().int().positive().nullish(),
  clientEventId: trimmed.max(120).optional(),
});
export type RepairCreateInput = z.infer<typeof RepairCreateBody>;

export const RepairUpdateBody = z.object({
  status: z.enum(REPAIR_ALL_STATUSES).optional(),
  summary: trimmed.min(1).max(500).optional(),
  partsUsed: z.array(RepairPart).max(100).nullish(),
  laborMinutes: z.number().int().nonnegative().nullish(),
  costCents: z.number().int().nonnegative().nullish(),
  clientEventId: trimmed.max(120).optional(),
});
export type RepairUpdateInput = z.infer<typeof RepairUpdateBody>;
