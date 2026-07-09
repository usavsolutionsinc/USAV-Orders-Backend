/**
 * Buyer-note → entity_signals mirror derivation (plan §2.3, external emitter
 * standard — eBay first; Amazon rides the same module later, behind RDT).
 *
 * Signals are a PROJECTION OF THE LOCAL MIRROR (`orders.buyer_note`, migration
 * 2026-07-03p), never a side-effect of the connector. Two triggers share this
 * one function:
 *   • FRESH PATH — fire-and-forget hook in the sync orchestrator after a
 *     provider sync (tapWorkflow semantics: best-effort, never fails a sync).
 *   • HEAL PATH — the nightly `/api/cron/signals/buyer-notes-heal` sweep under
 *     withCronLock, re-scanning a wider window.
 * Both are free no-ops on rows already emitted: `source_ref` +
 * ux_entity_signals_source_ref make double-emission structurally impossible.
 * A full backfill is just this sweep with a bigger `limit`.
 *
 * Window shape: the legacy `orders` mirror has no updated_at, so the sweep
 * scans the newest N candidate rows by id (org-scoped, buyer_note present).
 * Idempotency makes over-scanning free; under-scanning heals next night.
 *
 * `source_ref` = `ebay-note:<orderPk>:<sha16(note)>` — the platform gives
 * buyerCheckoutNotes no id, so the ref is a hash of the note text keyed to the
 * mirror row (plan §2.3: "sha of order-id+note text"). An edited note is a new
 * signal by design.
 *
 * No interpretation at ingest (§2.3 point 6): raw text lands as
 * signal_kind='buyer_note'; semantic bucketing into reason_code is a later
 * classifier, never here.
 *
 * Tenancy: gated per-tenant via isBuyerNoteSignals(orgId) (flag
 * buyer_note_signals / env BUYER_NOTE_SIGNALS); org comes from the sync
 * connection / cron org loop — never inferred from a payload.
 *
 * Deps-injected (default real impls) so unit tests run DB-free.
 */

import { createHash } from 'node:crypto';
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { isBuyerNoteSignals } from '@/lib/feature-flags';
import { recordEntitySignal, type RecordEntitySignalInput, type RecordEntitySignalResult } from './record-entity-signal';

export interface BuyerNoteCandidateRow {
  id: number;
  buyer_note: string;
  account_source: string | null;
  order_id: string | null;
  order_date: string | null;
  created_at: string | null;
}

export interface DeriveBuyerNoteSignalsDeps {
  isEnabled: (orgId: OrgId) => Promise<boolean>;
  listCandidates: (orgId: OrgId, limit: number) => Promise<BuyerNoteCandidateRow[]>;
  recordSignal: (input: RecordEntitySignalInput) => Promise<RecordEntitySignalResult>;
}

async function listCandidateRows(orgId: OrgId, limit: number): Promise<BuyerNoteCandidateRow[]> {
  // Owner-pool read with an explicit org predicate (read-only; the write side
  // goes through recordEntitySignal → withTenantTransaction).
  const r = await pool.query<BuyerNoteCandidateRow>(
    `SELECT id, buyer_note, account_source, order_id,
            order_date::text AS order_date, created_at::text AS created_at
       FROM orders
      WHERE organization_id = $1
        AND buyer_note IS NOT NULL
        AND btrim(buyer_note) <> ''
      ORDER BY id DESC
      LIMIT $2`,
    [orgId, limit],
  );
  return r.rows;
}

const defaultDeps: DeriveBuyerNoteSignalsDeps = {
  isEnabled: isBuyerNoteSignals,
  listCandidates: listCandidateRows,
  recordSignal: recordEntitySignal,
};

export interface DeriveBuyerNoteSignalsResult {
  enabled: boolean;
  scanned: number;
  emitted: number;
  duplicates: number;
  failed: number;
}

export function buyerNoteSourceRef(orderPk: number, note: string): string {
  const sha16 = createHash('sha256').update(`${orderPk}\n${note}`).digest('hex').slice(0, 16);
  return `ebay-note:${orderPk}:${sha16}`;
}

export async function deriveBuyerNoteSignals(
  orgId: OrgId,
  opts: { limit?: number } = {},
  deps: DeriveBuyerNoteSignalsDeps = defaultDeps,
): Promise<DeriveBuyerNoteSignalsResult> {
  if (!(await deps.isEnabled(orgId))) {
    return { enabled: false, scanned: 0, emitted: 0, duplicates: 0, failed: 0 };
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 500, 10_000));
  const rows = await deps.listCandidates(orgId, limit);

  let emitted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const row of rows) {
    const note = row.buyer_note.trim();
    if (!note) continue;
    try {
      const result = await deps.recordSignal({
        organizationId: orgId,
        entityType: 'ORDER',
        entityId: row.id,
        signalKind: 'buyer_note',
        notes: note,
        occurredAt: row.order_date ?? row.created_at ?? null,
        sourceRef: buyerNoteSourceRef(row.id, note),
        meta: {
          accountSource: row.account_source,
          orderId: row.order_id,
          platform: 'ebay',
        },
      });
      if (!result.ok) failed += 1;
      else if (result.duplicate) duplicates += 1;
      else emitted += 1;
    } catch (err) {
      failed += 1;
      console.warn(`[buyer-note-derivation] signal write failed for order ${row.id} (non-fatal):`, err);
    }
  }

  return { enabled: true, scanned: rows.length, emitted, duplicates, failed };
}

/**
 * Fresh-path hook for the sync orchestrator — tapWorkflow semantics: never
 * throws, never rejects, never fails a sync.
 */
export async function tapBuyerNoteDerivation(orgId: OrgId): Promise<void> {
  try {
    await deriveBuyerNoteSignals(orgId, { limit: 500 });
  } catch (err) {
    console.warn('[buyer-note-derivation] fresh-path tap failed (non-fatal):', err);
  }
}
