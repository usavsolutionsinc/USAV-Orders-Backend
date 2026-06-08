import { z } from 'zod';

/**
 * Validation for the failure-mode taxonomy + per-unit failure tags.
 * See docs/condition-grading-repair-qc-plan.md §4.3/§4.4.
 */

const trimmed = z.string().trim();

export const FAILURE_CATEGORIES = ['hardware', 'software', 'cosmetic', 'electrical', 'accessory', 'other'] as const;
export const FAILURE_SEVERITIES = ['critical', 'major', 'minor'] as const;
export const FAILURE_TAG_SOURCES = ['qc', 'return', 'manual', 'repair'] as const;
export const FAILURE_TAG_RESOLUTIONS = ['open', 'resolved', 'scrapped', 'wontfix'] as const;
/** Mirrors condition_grade_enum (schema.ts). */
export const CONDITION_GRADES = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;

export const FailureModeCreateBody = z.object({
  code: trimmed.min(1).max(60),
  label: trimmed.min(1).max(120),
  category: z.enum(FAILURE_CATEGORIES).optional(),
  severity: z.enum(FAILURE_SEVERITIES).optional(),
  isRepairable: z.boolean().optional(),
  typicalCostCents: z.number().int().nonnegative().nullish(),
  capsGradeAt: z.enum(CONDITION_GRADES).nullish(),
  sortOrder: z.number().int().min(0).optional(),
  idempotencyKey: trimmed.max(120).optional(),
});

export const FailureModeUpdateBody = z.object({
  label: trimmed.min(1).max(120).optional(),
  category: z.enum(FAILURE_CATEGORIES).optional(),
  severity: z.enum(FAILURE_SEVERITIES).optional(),
  isRepairable: z.boolean().optional(),
  typicalCostCents: z.number().int().nonnegative().nullish(),
  capsGradeAt: z.enum(CONDITION_GRADES).nullish(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export const FailureTagCreateBody = z.object({
  failureModeId: z.coerce.number().int().positive(),
  source: z.enum(FAILURE_TAG_SOURCES).optional(),
  notes: trimmed.max(2000).nullish(),
});

export const FailureTagPatchBody = z.object({
  tagId: z.coerce.number().int().positive(),
  resolutionStatus: z.enum(FAILURE_TAG_RESOLUTIONS),
  notes: trimmed.max(2000).nullish(),
});
