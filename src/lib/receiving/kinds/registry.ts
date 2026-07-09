/**
 * Intake-kind registry — the polymorphic discriminator for receiving.
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 2) / §5.
 *
 * A receiving line's *kind* (PO | RETURN | TRADE_IN | PICKUP) decides which typed
 * facts attach to it. This registry maps each kind to its facts tables + default
 * `receiving_line_facts` kinds, and owns the classification helpers. It is the
 * code-side SoT for the built-in kinds; per-org custom kinds resolve through the
 * `types` catalog (catalog-queries) with a passthrough facts schema, so a tenant
 * can add a kind with catalog data + a registry entry and zero migration.
 *
 * Reuses the door classification SoT in ../intake-classification (so the door
 * tag, the carton columns, and the kind can never disagree).
 *
 * Pure module — no DB, no React.
 */

import { columnsToClassification, type IntakeClassification } from '../intake-classification';
import type { FactKind } from '../facts/registry';

/** Coarse intake kinds (the receiving_type / intake_type vocabulary). */
export const INTAKE_KINDS = ['PO', 'RETURN', 'TRADE_IN', 'PICKUP'] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

/** The narrow 1:1 facts tables a line can carry. */
export type KindFactTable =
  | 'receiving_line_zoho'
  | 'receiving_line_return'
  | 'receiving_line_testing'
  | 'receiving_line_putaway';

/**
 * Stage facts apply to EVERY kind (they describe where the line is in the flow,
 * not what kind it is). Kind-specific tables are layered on top per kind.
 */
export const UNIVERSAL_FACT_TABLES: ReadonlyArray<KindFactTable> = [
  'receiving_line_testing',
  'receiving_line_putaway',
];

export interface IntakeKindDef {
  kind: IntakeKind;
  label: string;
  /** Kind-specific 1:1 facts tables (besides the universal stage tables). */
  kindFactTables: ReadonlyArray<KindFactTable>;
  /** receiving_line_facts kinds typically attached for this intake kind. */
  defaultFactKinds: ReadonlyArray<FactKind>;
}

const REGISTRY: Record<IntakeKind, IntakeKindDef> = {
  PO: {
    kind: 'PO',
    label: 'Purchase Order',
    kindFactTables: ['receiving_line_zoho'],
    defaultFactKinds: ['sourcing_import'],
  },
  RETURN: {
    kind: 'RETURN',
    label: 'Return',
    kindFactTables: ['receiving_line_return'],
    defaultFactKinds: ['marketplace_listing'],
  },
  TRADE_IN: {
    kind: 'TRADE_IN',
    label: 'Trade-In',
    kindFactTables: ['receiving_line_return'],
    defaultFactKinds: ['trade_in_valuation'],
  },
  PICKUP: {
    kind: 'PICKUP',
    label: 'Local Pickup',
    kindFactTables: [],
    defaultFactKinds: [],
  },
};

export function isIntakeKind(v: unknown): v is IntakeKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, v);
}

export function getIntakeKindDef(kind: IntakeKind): IntakeKindDef {
  return REGISTRY[kind];
}

export function intakeKindLabel(kind: IntakeKind): string {
  return REGISTRY[kind].label;
}

/** All 1:1 facts tables for a kind = kind-specific + universal stage tables. */
export function factTablesForKind(kind: IntakeKind): ReadonlyArray<KindFactTable> {
  return [...REGISTRY[kind].kindFactTables, ...UNIVERSAL_FACT_TABLES];
}

/** Fine door classification → coarse intake kind. */
export function intakeKindFromClassification(c: IntakeClassification): IntakeKind {
  switch (c) {
    case 'TRADE_IN':
      return 'TRADE_IN';
    case 'LOCAL_PICKUP':
      return 'PICKUP';
    case 'PO':
    case 'UNKNOWN':
      return 'PO';
    default:
      return 'RETURN'; // every *_RETURN classification
  }
}

/** Derive the coarse kind from a carton/line's stored columns (for display/routing). */
export function classifyIntakeKind(columns: Parameters<typeof columnsToClassification>[0]): IntakeKind {
  return intakeKindFromClassification(columnsToClassification(columns));
}

/**
 * Resolve the effective kind from a line override + carton default: the line
 * override wins unless it is the 'PO' default, else the carton default, else
 * 'PO'. SoT for this precedence rule — `triage-intake-kind.ts`'s
 * `isReturnIntake()` composes off this. Two call sites that look similar are
 * deliberately NOT migrated to it: `useReceivingType.ts` seeds a carton-type
 * EDITOR pill (correctly carton-first — it answers "what should this carton's
 * own field show," not "what's the line's effective type"), and
 * `zendesk-claim-template.ts`'s inline version must pass through org-custom
 * type strings verbatim (it feeds a display label, not this kind enum) and
 * has no carton-level default field available at its call site anyway.
 */
export function effectiveIntakeKind(
  lineKind?: string | null,
  cartonKind?: string | null,
): IntakeKind {
  const norm = (v?: string | null): IntakeKind | null => {
    const u = (v ?? '').trim().toUpperCase();
    return isIntakeKind(u) ? u : null;
  };
  const line = norm(lineKind);
  if (line && line !== 'PO') return line;
  return norm(cartonKind) ?? line ?? 'PO';
}
