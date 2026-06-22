/**
 * Shared types + tiny pure helpers for the SKU testing panel. No React.
 */

export interface ChecklistStep {
  step_id: number;
  step_label: string;
  step_type: string;
  sort_order: number;
  // ─ Structured-value config (Phase 1; docs/qc-crud-endpoints-plan.md) ─
  value_kind?: string | null;
  value_unit?: string | null;
  value_enum?: string[] | null;
  pass_min?: string | number | null;
  pass_max?: string | number | null;
}

export interface ManualRow {
  id: number;
  display_name: string | null;
  type: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  file_name: string | null;
}

export interface UnitResult {
  step_id: number;
  passed: boolean | null;
  verified_by_name: string | null;
  /** Recorded structured values for value-kind steps. */
  value_num?: string | number | null;
  value_text?: string | null;
}

export interface Bundle {
  skuCatalogId: number | null;
  sku: string | null;
  title: string | null;
  checklist: ChecklistStep[];
  manuals: ManualRow[];
}

/** Numeric value kinds capture a number (and may have a pass band). */
export const NUMERIC_VALUE_KINDS = new Set(['PERCENT', 'NUMBER']);

/** Steps whose answer is a structured value rather than a pass/fail tap. */
export function needsValueInput(kind?: string | null): boolean {
  return kind === 'PERCENT' || kind === 'NUMBER' || kind === 'ENUM' || kind === 'TEXT';
}

// Mirrors the surface tokens in TechTestingWorkspace — flat hairline card +
// quieted section label. Keep these in sync (see /design-demo).
export const SECTION = 'rounded-2xl bg-white p-4 ring-1 ring-gray-200/70';
export const EYEBROW = 'text-caption font-semibold text-gray-400';
