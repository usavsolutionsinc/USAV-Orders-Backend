/**
 * Unified shipment linkage helper — the single write/read API for the polymorphic
 * `shipment_links` table that subsumes the two parallel junctions
 * (`receiving_shipments` inbound + `order_shipment_links` outbound) against the one
 * STN master. One row per (org, owner, shipment); many-trackings-per-owner; the
 * is_primary row mirrors the denormalized receiving.shipment_id / orders.shipment_id
 * caches.
 *
 * During the bake, writers DUAL-WRITE: they keep writing their legacy junction
 * (the read path still uses it) and ALSO call `linkShipment()` so shipment_links
 * stays current. After the read cutover + bake, the legacy junctions are dropped
 * (Phase 6) and this is the sole linkage SoT.
 *
 * Org-scoped. Pass a tx `client` to enlist in the caller's transaction (the
 * common dual-write case); omit it to run self-contained under
 * withTenantTransaction. Deps-free at the query layer — testable by passing a
 * fake `client`.
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type ShipmentOwnerType = 'RECEIVING' | 'ORDER';
export type ShipmentDirection = 'INBOUND' | 'OUTBOUND';

export interface LinkShipmentInput {
  ownerType: ShipmentOwnerType;
  ownerId: number;
  shipmentId: number;
  direction: ShipmentDirection;
  /** Omit → next box_seq for the owner. Pass to mirror a legacy junction's seq exactly. */
  boxSeq?: number | null;
  /** true → demote the owner's other primaries first, then set this one primary. */
  isPrimary?: boolean;
  role?: string | null;
  source?: string | null;
  linkedBy?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ShipmentLinkRow {
  id: number;
  box_seq: number;
  is_primary: boolean;
}

type Client = Pick<PoolClient, 'query'>;

/**
 * Upsert one owner↔shipment link. Idempotent on (org, owner_type, owner_id,
 * shipment_id). When `isPrimary` is set, the owner's other primaries are demoted
 * first so the partial-unique one-primary-per-owner index can never be violated.
 */
export async function linkShipment(
  orgId: OrgId,
  input: LinkShipmentInput,
  client?: Client,
): Promise<ShipmentLinkRow> {
  const run = async (c: Client): Promise<ShipmentLinkRow> => {
    let boxSeq = input.boxSeq;
    if (boxSeq == null) {
      const m = await c.query<{ n: number }>(
        `SELECT COALESCE(MAX(box_seq), 0) + 1 AS n
           FROM shipment_links
          WHERE organization_id = $1 AND owner_type = $2 AND owner_id = $3`,
        [orgId, input.ownerType, input.ownerId],
      );
      boxSeq = Number(m.rows[0]?.n ?? 1);
    }

    if (input.isPrimary) {
      await c.query(
        `UPDATE shipment_links SET is_primary = false, updated_at = NOW()
          WHERE organization_id = $1 AND owner_type = $2 AND owner_id = $3
            AND is_primary AND shipment_id <> $4`,
        [orgId, input.ownerType, input.ownerId, input.shipmentId],
      );
    }

    const r = await c.query<ShipmentLinkRow>(
      `INSERT INTO shipment_links
         (organization_id, owner_type, owner_id, shipment_id, box_seq, is_primary,
          direction, role, source, linked_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (organization_id, owner_type, owner_id, shipment_id) DO UPDATE SET
         box_seq    = EXCLUDED.box_seq,
         is_primary = EXCLUDED.is_primary,
         direction  = EXCLUDED.direction,
         role       = COALESCE(EXCLUDED.role, shipment_links.role),
         source     = COALESCE(EXCLUDED.source, shipment_links.source),
         linked_by  = COALESCE(EXCLUDED.linked_by, shipment_links.linked_by),
         updated_at = NOW()
       RETURNING id, box_seq, is_primary`,
      [
        orgId, input.ownerType, input.ownerId, input.shipmentId, boxSeq,
        input.isPrimary ?? false, input.direction, input.role ?? null,
        input.source ?? null, input.linkedBy ?? null, JSON.stringify(input.metadata ?? {}),
      ],
    );
    return r.rows[0];
  };

  if (client) return run(client);
  return withTenantTransaction<ShipmentLinkRow>(orgId, run);
}

/** Promote one link to primary (demoting the owner's others). */
export async function setPrimaryShipmentLink(
  orgId: OrgId,
  ownerType: ShipmentOwnerType,
  ownerId: number,
  shipmentId: number,
  client?: Client,
): Promise<void> {
  const run = async (c: Client) => {
    await c.query(
      `UPDATE shipment_links SET is_primary = (shipment_id = $4), updated_at = NOW()
        WHERE organization_id = $1 AND owner_type = $2 AND owner_id = $3`,
      [orgId, ownerType, ownerId, shipmentId],
    );
  };
  if (client) return run(client);
  await withTenantTransaction(orgId, async (c) => { await run(c); return null; });
}

/** Remove one owner↔shipment link. */
export async function unlinkShipment(
  orgId: OrgId,
  ownerType: ShipmentOwnerType,
  ownerId: number,
  shipmentId: number,
  client?: Client,
): Promise<void> {
  const run = async (c: Client) => {
    await c.query(
      `DELETE FROM shipment_links
        WHERE organization_id = $1 AND owner_type = $2 AND owner_id = $3 AND shipment_id = $4`,
      [orgId, ownerType, ownerId, shipmentId],
    );
  };
  if (client) return run(client);
  await withTenantTransaction(orgId, async (c) => { await run(c); return null; });
}

export interface OwnerShipmentLink {
  shipment_id: number;
  box_seq: number;
  is_primary: boolean;
  role: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status_category: string | null;
  is_delivered: boolean | null;
}

/** All trackings linked to an owner, primary first then box order (joined to STN). */
export async function listLinksForOwner(
  orgId: OrgId,
  ownerType: ShipmentOwnerType,
  ownerId: number,
  client?: Client,
): Promise<OwnerShipmentLink[]> {
  const run = async (c: Client) => {
    const r = await c.query<OwnerShipmentLink>(
      `SELECT sl.shipment_id, sl.box_seq, sl.is_primary, sl.role,
              stn.tracking_number_raw        AS tracking_number,
              NULLIF(stn.carrier, 'UNKNOWN') AS carrier,
              stn.latest_status_category     AS status_category,
              stn.is_delivered               AS is_delivered
         FROM shipment_links sl
         JOIN shipping_tracking_numbers stn ON stn.id = sl.shipment_id
        WHERE sl.organization_id = $1 AND sl.owner_type = $2 AND sl.owner_id = $3
        ORDER BY sl.is_primary DESC, sl.box_seq ASC, sl.id ASC`,
      [orgId, ownerType, ownerId],
    );
    return r.rows;
  };
  if (client) return run(client);
  return withTenantTransaction<OwnerShipmentLink[]>(orgId, run);
}
