import { z } from 'zod';
import { OPS_PLAN_STATIONS, OPS_PLAN_STATUSES, OPS_PLAN_TASK_LINK_TYPES, OPS_PLAN_TASK_STATUSES } from '@/lib/ops-plans/constants';

export const OpsPlanStation = z.enum(OPS_PLAN_STATIONS);

export const CreatePlanBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const UpdatePlanBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(OPS_PLAN_STATUSES).optional(),
});

export const CreatePlanFromTemplateBody = z.object({
  templateKey: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200).optional(),
});

export const CreatePhaseBody = z.object({
  station: OpsPlanStation,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

export const UpdatePhaseBody = z.object({
  station: OpsPlanStation.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

export const CreateTaskBody = z.object({
  title: z.string().trim().min(1).max(500),
  assigneeStaffId: z.number().int().positive().optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  clientEventId: z.string().trim().min(1).max(200).optional().nullable(),
});

export const UpdateTaskBody = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  assigneeStaffId: z.number().int().positive().optional().nullable(),
  status: z.enum(OPS_PLAN_TASK_STATUSES).optional(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const CreateTaskLinkBody = z.object({
  linkType: z.enum(OPS_PLAN_TASK_LINK_TYPES),
  linkEntityType: z.string().trim().max(50).optional().nullable(),
  linkEntityId: z.string().trim().min(1).max(200),
});

export const InboxQuerySchema = z.object({
  staffId: z.union([z.literal('mine'), z.coerce.number().int().positive()]).optional(),
  station: OpsPlanStation.optional(),
  source: z.enum(['plan', 'operational', 'all']).optional(),
  status: z.enum(['open', 'all']).optional(),
  q: z.string().trim().max(200).optional(),
  planId: z.string().uuid().optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
