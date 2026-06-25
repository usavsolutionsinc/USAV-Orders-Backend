import { z } from 'zod';

/**
 * Validation for the polymorphic checklist endpoints (`checklist_templates`).
 * Single source of truth for /api/checklists CRUD. Kept intentionally close to
 * the QC schema (qc-checks.ts) so per-SKU checklists can grow into the same
 * structured-value shape later.
 */

const trimmed = z.string().trim();

export const CHECKLIST_SCOPE_TYPES = ['GLOBAL', 'CATEGORY', 'SKU'] as const;
export type ChecklistScopeType = (typeof CHECKLIST_SCOPE_TYPES)[number];

const scopeType = z.enum(CHECKLIST_SCOPE_TYPES);
const status = z.enum(['draft', 'published']);

/** GET query: which scope's checklist to read. */
export const ChecklistQuery = z
  .object({
    scopeType: scopeType.default('GLOBAL'),
    scopeId: z.coerce.number().int().positive().nullish(),
    publishedOnly: z
      .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.scopeType !== 'GLOBAL' && b.scopeId == null) {
      ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'scopeId required for non-GLOBAL scope' });
    }
  });

export const ChecklistCreateBody = z
  .object({
    scopeType: scopeType.default('GLOBAL'),
    scopeId: z.coerce.number().int().positive().nullish(),
    stepLabel: trimmed.min(1, 'stepLabel is required').max(200),
    stepType: trimmed.max(40).optional(),
    sortOrder: z.number().int().min(0).optional(),
    status: status.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.scopeType !== 'GLOBAL' && b.scopeId == null) {
      ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'scopeId required for non-GLOBAL scope' });
    }
  });

export const ChecklistUpdateBody = z.object({
  id: z.coerce.number().int().positive(),
  stepLabel: trimmed.min(1).max(200).optional(),
  stepType: trimmed.max(40).optional(),
  sortOrder: z.number().int().min(0).optional(),
  status: status.optional(),
});

export const ChecklistDeleteBody = z.object({
  id: z.coerce.number().int().positive(),
});

export type ChecklistCreateInput = z.infer<typeof ChecklistCreateBody>;
export type ChecklistUpdateInput = z.infer<typeof ChecklistUpdateBody>;
