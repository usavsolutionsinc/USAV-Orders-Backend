/**
 * Receiving narrow-facts helpers — typed read/write for the four 1:1 facts
 * tables (receiving_line_zoho / _testing / _return / _putaway).
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 2).
 *
 * Each table is keyed on receiving_line_id (the 1:1 subtype shape), so writes are
 * an upsert on that key. The upsert is PARTIAL: a field left `undefined` is not
 * touched; a field set to `null` clears it. This lets a street set just the facts
 * it owns (e.g. testing sets needs_test without disturbing a return's columns).
 *
 * Org-scoped + Deps-injected (default real impls) so unit tests run DB-free —
 * same convention as exceptions.ts / store.ts.
 *
 * Table + column names here are fixed internal constants (never user input), so
 * the small amount of identifier interpolation in upsertNarrow is injection-safe.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { FactsDeps } from './store';

const defaultDeps: FactsDeps = { query: tenantQuery };

type NarrowTable =
  | 'receiving_line_zoho'
  | 'receiving_line_testing'
  | 'receiving_line_return'
  | 'receiving_line_putaway';

/**
 * Partial upsert into a 1:1 facts table. Only keys whose value is not `undefined`
 * are written; `null` clears. Always bumps updated_at. Returns nothing — these
 * are fire-and-set; read back with the typed readers if needed.
 */
async function upsertNarrow(
  table: NarrowTable,
  orgId: OrgId,
  receivingLineId: number,
  fields: Record<string, unknown>,
  deps: FactsDeps,
): Promise<void> {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const insertCols = ['receiving_line_id', 'organization_id', ...cols];
  const values: unknown[] = [receivingLineId, orgId, ...cols.map((c) => fields[c])];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`);
  const setClause = [...cols.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ');
  const sql =
    `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')}) ` +
    `ON CONFLICT (receiving_line_id) DO UPDATE SET ${setClause}`;
  await deps.query(orgId, sql, values);
}

async function readNarrow<T extends Record<string, unknown>>(
  table: NarrowTable,
  orgId: OrgId,
  receivingLineId: number,
  deps: FactsDeps,
): Promise<T | null> {
  const r = await deps.query<T>(
    orgId,
    `SELECT * FROM ${table} WHERE organization_id = $1 AND receiving_line_id = $2`,
    [orgId, receivingLineId],
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

// ── receiving_line_zoho ─────────────────────────────────────────────────────
export interface ZohoFactsInput {
  zohoItemId?: string | null;
  zohoLineItemId?: string | null;
  zohoPurchaseReceiveId?: string | null;
  zohoPurchaseOrderId?: string | null;
  zohoPurchaseOrderNumber?: string | null;
  zohoReferenceNumber?: string | null;
  zohoSyncSource?: string | null;
  zohoLastModifiedTime?: string | null;
  zohoSyncedAt?: string | null;
  zohoNotes?: string | null;
  unitPrice?: number | string | null;
}

export function upsertReceivingLineZoho(
  orgId: OrgId,
  receivingLineId: number,
  f: ZohoFactsInput,
  deps: FactsDeps = defaultDeps,
): Promise<void> {
  return upsertNarrow('receiving_line_zoho', orgId, receivingLineId, {
    zoho_item_id: f.zohoItemId,
    zoho_line_item_id: f.zohoLineItemId,
    zoho_purchase_receive_id: f.zohoPurchaseReceiveId,
    zoho_purchaseorder_id: f.zohoPurchaseOrderId,
    zoho_purchaseorder_number: f.zohoPurchaseOrderNumber,
    zoho_reference_number: f.zohoReferenceNumber,
    zoho_sync_source: f.zohoSyncSource,
    zoho_last_modified_time: f.zohoLastModifiedTime,
    zoho_synced_at: f.zohoSyncedAt,
    zoho_notes: f.zohoNotes,
    unit_price: f.unitPrice,
  }, deps);
}

export function readReceivingLineZoho(orgId: OrgId, receivingLineId: number, deps: FactsDeps = defaultDeps) {
  return readNarrow('receiving_line_zoho', orgId, receivingLineId, deps);
}

// ── receiving_line_testing ──────────────────────────────────────────────────
export interface TestingFactsInput {
  needsTest?: boolean;
  assignedTechId?: number | null;
  qaStatus?: string;
  dispositionCode?: string;
  conditionGrade?: string;
  dispositionFinal?: string | null;
  dispositionAudit?: unknown; // jsonb
}

export function upsertReceivingLineTesting(
  orgId: OrgId,
  receivingLineId: number,
  f: TestingFactsInput,
  deps: FactsDeps = defaultDeps,
): Promise<void> {
  return upsertNarrow('receiving_line_testing', orgId, receivingLineId, {
    needs_test: f.needsTest,
    assigned_tech_id: f.assignedTechId,
    qa_status: f.qaStatus,
    disposition_code: f.dispositionCode,
    condition_grade: f.conditionGrade,
    disposition_final: f.dispositionFinal,
    disposition_audit: f.dispositionAudit === undefined ? undefined : JSON.stringify(f.dispositionAudit),
  }, deps);
}

export function readReceivingLineTesting(orgId: OrgId, receivingLineId: number, deps: FactsDeps = defaultDeps) {
  return readNarrow('receiving_line_testing', orgId, receivingLineId, deps);
}

// ── receiving_line_return ───────────────────────────────────────────────────
export interface ReturnFactsInput {
  returnPlatform?: string | null;
  returnReason?: string | null;
  sourceOrderId?: string | null;
  rmaRef?: string | null;
}

export function upsertReceivingLineReturn(
  orgId: OrgId,
  receivingLineId: number,
  f: ReturnFactsInput,
  deps: FactsDeps = defaultDeps,
): Promise<void> {
  return upsertNarrow('receiving_line_return', orgId, receivingLineId, {
    return_platform: f.returnPlatform,
    return_reason: f.returnReason,
    source_order_id: f.sourceOrderId,
    rma_ref: f.rmaRef,
  }, deps);
}

export function readReceivingLineReturn(orgId: OrgId, receivingLineId: number, deps: FactsDeps = defaultDeps) {
  return readNarrow('receiving_line_return', orgId, receivingLineId, deps);
}

// ── receiving_line_putaway ──────────────────────────────────────────────────
export interface PutawayFactsInput {
  locationCode?: string | null;
  bin?: string | null;
  putAwayAt?: string | null;
  putAwayBy?: number | null;
}

export function upsertReceivingLinePutaway(
  orgId: OrgId,
  receivingLineId: number,
  f: PutawayFactsInput,
  deps: FactsDeps = defaultDeps,
): Promise<void> {
  return upsertNarrow('receiving_line_putaway', orgId, receivingLineId, {
    location_code: f.locationCode,
    bin: f.bin,
    put_away_at: f.putAwayAt,
    put_away_by: f.putAwayBy,
  }, deps);
}

export function readReceivingLinePutaway(orgId: OrgId, receivingLineId: number, deps: FactsDeps = defaultDeps) {
  return readNarrow('receiving_line_putaway', orgId, receivingLineId, deps);
}
