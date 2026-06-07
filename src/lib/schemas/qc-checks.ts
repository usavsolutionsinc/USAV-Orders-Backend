import { z } from 'zod';

/**
 * Validation for the QC checklist endpoints (qc_check_templates authoring +
 * tech_verifications execution). Single source of truth shared by:
 *   - /api/sku-catalog/[id]/qc-checks        (catalog authoring CRUD)
 *   - /api/receiving-lines/[id]/qc-checks    (tech inline authoring CRUD)
 *   - /api/serial-units/[id]/checklist       (per-unit execution)
 *   - /api/serial-units/[id]/checklist/bulk  (bulk settle)
 *
 * See docs/qc-crud-endpoints-plan.md.
 */

const trimmed = z.string().trim();

/** How a step's answer is captured. `null`/absent = legacy pass/fail boolean. */
export const QC_VALUE_KINDS = ['BOOLEAN', 'PERCENT', 'NUMBER', 'ENUM', 'TEXT'] as const;
export type QcValueKind = (typeof QC_VALUE_KINDS)[number];

/** Authoring lifecycle. Drafts are hidden from execution views until published. */
export const QC_STATUS = ['draft', 'published'] as const;
export type QcStatus = (typeof QC_STATUS)[number];

const valueKind = z.enum(QC_VALUE_KINDS);
const status = z.enum(QC_STATUS);

/** Structured-value config shared by create + update. */
const valueConfig = {
  valueKind: valueKind.nullish(),
  valueUnit: trimmed.min(1).max(20).nullish(),
  valueEnum: z.array(trimmed.min(1)).nullish(),
  passMin: z.number().finite().nullish(),
  passMax: z.number().finite().nullish(),
  /** Failure mode to auto-tag on the unit when this step fails. */
  failureModeId: z.coerce.number().int().positive().nullish(),
};

/** pass band must be ordered; an enum list only makes sense for ENUM steps. */
function refineValueConfig<T extends {
  valueKind?: QcValueKind | null;
  valueEnum?: string[] | null;
  passMin?: number | null;
  passMax?: number | null;
}>(b: T, ctx: z.RefinementCtx) {
  if (b.passMin != null && b.passMax != null && b.passMin > b.passMax) {
    ctx.addIssue({ code: 'custom', path: ['passMin'], message: 'passMin must be <= passMax' });
  }
  if (b.valueEnum != null && b.valueEnum.length > 0 && b.valueKind !== 'ENUM') {
    ctx.addIssue({ code: 'custom', path: ['valueEnum'], message: 'valueEnum requires valueKind=ENUM' });
  }
}

// ─── Authoring: qc_check_templates CRUD ─────────────────────────────────────

export const QcCheckCreateBody = z
  .object({
    stepLabel: trimmed.min(1, 'stepLabel is required').max(200),
    stepType: trimmed.max(40).optional(),
    sortOrder: z.number().int().min(0).optional(),
    status: status.optional(), // helper defaults to 'published'
    ...valueConfig,
    idempotencyKey: trimmed.max(120).optional(),
  })
  .superRefine(refineValueConfig);
export type QcCheckCreateInput = z.infer<typeof QcCheckCreateBody>;

export const QcCheckUpdateBody = z
  .object({
    checkId: z.coerce.number().int().positive(),
    stepLabel: trimmed.min(1).max(200).optional(),
    stepType: trimmed.max(40).optional(),
    sortOrder: z.number().int().min(0).optional(),
    status: status.optional(),
    ...valueConfig,
  })
  .superRefine(refineValueConfig);
export type QcCheckUpdateInput = z.infer<typeof QcCheckUpdateBody>;

export const QcCheckDeleteBody = z.object({
  checkId: z.coerce.number().int().positive(),
});

// ─── Execution: tech_verifications ──────────────────────────────────────────

/** Record one step result for a unit. `passed` may be omitted when the step
 *  has a numeric pass band — the server derives it from `valueNum`. */
export const QcResultBody = z.object({
  stepId: z.coerce.number().int().positive(),
  passed: z.boolean().optional(),
  valueNum: z.number().finite().nullish(),
  valueText: trimmed.max(2000).nullish(),
  notes: trimmed.max(2000).nullish(),
});
export type QcResultInput = z.infer<typeof QcResultBody>;

export const QcBulkBody = z.object({
  action: z.enum(['pass', 'clear']).default('pass'),
});
