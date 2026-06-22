/**
 * markUnitListed — record that a serial unit went live on a sales channel.
 *
 * The per-unit "listed" fact (UNIFIED-ENGINE-MASTER-PLAN §1.4). A unit that
 * passes test pools at the `list_ebay` workflow node because nothing marks a
 * *unit* listed — `platform_listings` is SKU-level. This helper writes the
 * missing per-unit row (serial_unit_listings) + one LISTED inventory_event,
 * atomically and tenant-scoped. The caller then fires tapWorkflow('listed')
 * AFTER commit so an enrolled unit advances list_ebay → pack.
 *
 * It does NOT change serial_units.current_status: LISTED is a SEPARATE AXIS from
 * lifecycle status (DISCOVERY §3). Listing is orthogonal to where the unit sits
 * in the receive→test→ship lifecycle.
 *
 * Idempotency: one listing row per (org, unit, platform). A re-list UPSERTs and
 * returns idempotent:true (the LISTED event de-dupes a true retry on
 * client_event_id). Collaborators are injected (real impls by default) so this
 * is unit-testable DB-free — same pattern as applyTransition().
 */

import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { recordInventoryEvent, type RecordInventoryEventInput } from './events';

export interface MarkUnitListedArgs {
  /** serial_units.id */
  unitId: number;
  /** Tenant — scopes the unit lock + listing UPSERT + stamps the event. */
  orgId: OrgId;
  /** Sales channel the unit went live on. Defaults to 'ebay'. */
  platform?: string;
  /** External listing/offer id when known (eBay listing id, ASIN, …). */
  externalRefId?: string | null;
  /** Channel price at list time, in cents (repo convention). */
  listingPriceCents?: number | null;
  actorStaffId?: number | null;
  /** Idempotency key for the LISTED inventory_event (UNIQUE(client_event_id)). */
  clientEventId?: string | null;
  notes?: string | null;
}

export type MarkUnitListedResult =
  | {
      ok: true;
      status: 200;
      serialUnitId: number;
      listingId: number;
      sku: string | null;
      platform: string;
      externalRefId: string | null;
      eventId: number | null;
      /** true when the unit already had a listing row on this platform (re-list). */
      idempotent: boolean;
    }
  | { ok: false; status: 404; error: string };

/** Injectable collaborators (real impls by default; fakes in tests). */
export interface MarkUnitListedDeps {
  withTx: <T>(orgId: OrgId, fn: (client: Pick<PoolClient, 'query'>) => Promise<T>) => Promise<T>;
  recordEvent: (
    input: RecordInventoryEventInput,
    client?: Pick<PoolClient, 'query'>,
    orgId?: OrgId,
  ) => Promise<{ id: number }>;
}

const defaultDeps: MarkUnitListedDeps = {
  withTx: withTenantTransaction,
  recordEvent: recordInventoryEvent,
};

export async function markUnitListed(
  args: MarkUnitListedArgs,
  deps: MarkUnitListedDeps = defaultDeps,
): Promise<MarkUnitListedResult> {
  const platform = (args.platform || 'ebay').trim().toLowerCase();

  return deps.withTx(args.orgId, async (client) => {
    // 1. Lock the unit, org-scoped → a cross-tenant id reads as not-found (404).
    const unitQ = await client.query<{ id: number; sku: string | null }>(
      `SELECT id, sku
         FROM serial_units
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE`,
      [args.unitId, args.orgId],
    );
    const unit = unitQ.rows[0];
    if (!unit) {
      return { ok: false as const, status: 404, error: `serial_unit ${args.unitId} not found` };
    }

    // 2. UPSERT the per-unit listing fact. xmax=0 ⇒ freshly inserted; otherwise a
    //    re-list of an existing row → idempotent. COALESCE keeps a previously
    //    captured external_ref_id / price / sku when the re-list omits them.
    const listingQ = await client.query<{ id: number; inserted: boolean }>(
      `INSERT INTO serial_unit_listings
         (organization_id, serial_unit_id, sku, platform, external_ref_id, listing_price_cents, status, listed_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'LISTED', $7)
       ON CONFLICT (organization_id, serial_unit_id, platform) DO UPDATE
         SET external_ref_id     = COALESCE(EXCLUDED.external_ref_id, serial_unit_listings.external_ref_id),
             listing_price_cents = COALESCE(EXCLUDED.listing_price_cents, serial_unit_listings.listing_price_cents),
             sku                 = COALESCE(EXCLUDED.sku, serial_unit_listings.sku),
             status              = 'LISTED',
             ended_at            = NULL,
             listed_by           = COALESCE(EXCLUDED.listed_by, serial_unit_listings.listed_by),
             listed_at           = now(),
             updated_at          = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        args.orgId,
        unit.id,
        unit.sku,
        platform,
        args.externalRefId ?? null,
        args.listingPriceCents ?? null,
        args.actorStaffId ?? null,
      ],
    );
    const listingRow = listingQ.rows[0];
    const idempotent = !listingRow.inserted;

    // 3. One LISTED inventory_event for the unit timeline (separate axis: no
    //    status change, so no prev/next status). The event INSERT inherits the
    //    GUC org from the transaction client. A timeline hiccup must not fail the
    //    list — the serial_unit_listings row is the SoT.
    let eventId: number | null = null;
    try {
      const ev = await deps.recordEvent(
        {
          event_type: 'LISTED',
          actor_staff_id: args.actorStaffId ?? null,
          station: null,
          serial_unit_id: unit.id,
          sku: unit.sku,
          client_event_id: args.clientEventId ?? null,
          notes: args.notes ?? null,
          payload: {
            source: 'serial-units.list',
            platform,
            external_ref_id: args.externalRefId ?? null,
            listing_id: listingRow.id,
            listing_price_cents: args.listingPriceCents ?? null,
            relist: idempotent,
          },
        },
        client,
      );
      eventId = ev.id;
    } catch (err) {
      console.warn('[markUnitListed] LISTED event failed (non-fatal)', err);
    }

    return {
      ok: true as const,
      status: 200,
      serialUnitId: unit.id,
      listingId: listingRow.id,
      sku: unit.sku,
      platform,
      externalRefId: args.externalRefId ?? null,
      eventId,
      idempotent,
    };
  });
}
