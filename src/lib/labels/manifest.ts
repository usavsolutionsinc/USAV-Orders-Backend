import type { PoolClient } from 'pg';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { shortSku, isoWeekParts, formatUnitId } from '@/lib/inventory/unit-id-format';

/**
 * label_manifests domain lib — the "one label, many serials" preboxed-kit layer
 * (serial↔label pairing plan §5.2). Combine = create OPEN → add items → SEAL →
 * print one master QR; Split = DISSOLVE (delete items). Membership only; a unit's
 * identity (unit_uid) is never re-minted.
 *
 * All org-scoped via tenantQuery / withTenantTransaction. "One live manifest per
 * unit" is enforced app-side here (skip + report conflicts) and backstopped by
 * the ux_label_manifest_items_one_live DB index.
 */

export type ManifestType = 'PREBOX' | 'KIT' | 'MASTER_CARTON';
export type ManifestStatus = 'OPEN' | 'SEALED' | 'DISSOLVED';

export interface ManifestRow {
  id: number;
  manifest_uid: string;
  manifest_type: ManifestType;
  sku: string | null;
  sku_catalog_id: number | null;
  condition_grade: string | null;
  status: ManifestStatus;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  sealed_at: string | null;
  updated_at: string;
}

export interface ManifestItemView {
  serial_unit_id: number;
  serial_number: string;
  unit_uid: string | null;
  sku: string | null;
  current_status: string;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
  ordinal: number;
}

export interface ManifestDetail extends ManifestRow {
  items: ManifestItemView[];
}

export interface CreateManifestInput {
  manifestType?: ManifestType;
  sku?: string | null;
  skuCatalogId?: number | null;
  conditionGrade?: string | null;
  notes?: string | null;
  createdBy?: number | null;
  /** Optional units to seed the OPEN manifest with (combine at create time). */
  serialUnitIds?: number[];
}

/** KIT-{SKU_SHORT}-{YYWW}-{SEQ6} — the unit-id family with a KIT- prefix. */
function buildManifestUid(sku: string | null | undefined, seq: number): string {
  const now = new Date();
  const { isoYear, isoWeek } = isoWeekParts(now);
  const skuShortValue = shortSku(sku || '') || 'KIT';
  return `KIT-${formatUnitId(skuShortValue, isoYear, isoWeek, seq)}`;
}

/** Atomically allocate the next per-org+year manifest sequence number. */
async function allocateManifestSeq(client: PoolClient, orgId: OrgId, year: number): Promise<number> {
  const res = await client.query<{ next_seq: number }>(
    `INSERT INTO label_manifest_sequences (organization_id, year, next_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (organization_id, year)
     DO UPDATE SET next_seq = label_manifest_sequences.next_seq + 1
     RETURNING next_seq`,
    [orgId, year],
  );
  return Number(res.rows[0]?.next_seq ?? 1);
}

/** Insert addable items inside an open transaction; returns added + conflicts. */
async function addItemsTx(
  client: PoolClient,
  orgId: OrgId,
  manifestId: number,
  serialUnitIds: number[],
): Promise<{ added: number[]; conflicts: number[] }> {
  const uniqueIds = Array.from(
    new Set(serialUnitIds.filter((n) => Number.isFinite(n) && n > 0)),
  );
  if (uniqueIds.length === 0) return { added: [], conflicts: [] };

  const existing = await client.query<{ serial_unit_id: number; manifest_id: number }>(
    `SELECT serial_unit_id, manifest_id FROM label_manifest_items
      WHERE organization_id = $1 AND serial_unit_id = ANY($2::int[])`,
    [orgId, uniqueIds],
  );
  const inOther = new Set(
    existing.rows.filter((r) => r.manifest_id !== manifestId).map((r) => r.serial_unit_id),
  );
  const inThis = new Set(
    existing.rows.filter((r) => r.manifest_id === manifestId).map((r) => r.serial_unit_id),
  );
  const toAdd = uniqueIds.filter((id) => !inOther.has(id) && !inThis.has(id));
  const conflicts = uniqueIds.filter((id) => inOther.has(id));

  if (toAdd.length > 0) {
    await client.query(
      `INSERT INTO label_manifest_items (organization_id, manifest_id, serial_unit_id, ordinal)
       SELECT $1, $2, u.id,
              COALESCE((SELECT MAX(ordinal) FROM label_manifest_items
                         WHERE organization_id = $1 AND manifest_id = $2), 0)
              + (row_number() OVER ())::int
         FROM unnest($3::int[]) AS u(id)
       ON CONFLICT DO NOTHING`,
      [orgId, manifestId, toAdd],
    );
  }
  return { added: toAdd, conflicts };
}

async function detailTx(
  client: PoolClient,
  orgId: OrgId,
  manifestId: number,
): Promise<ManifestDetail | null> {
  const m = await client.query<ManifestRow>(
    `SELECT * FROM label_manifests WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, manifestId],
  );
  const manifest = m.rows[0];
  if (!manifest) return null;
  const items = await client.query<ManifestItemView>(
    `SELECT su.id AS serial_unit_id, su.serial_number, su.unit_uid, su.sku,
            su.current_status, su.condition_grade, vo.origin_receiving_line_id, i.ordinal
       FROM label_manifest_items i
       JOIN serial_units su ON su.id = i.serial_unit_id
       LEFT JOIN v_serial_unit_origins vo ON vo.serial_unit_id = su.id
      WHERE i.organization_id = $1 AND i.manifest_id = $2
      ORDER BY i.ordinal ASC, i.id ASC`,
    [orgId, manifestId],
  );
  return { ...manifest, items: items.rows };
}

/** Create an OPEN manifest, optionally seeded with units. */
export async function createManifest(
  input: CreateManifestInput,
  orgId: OrgId,
): Promise<{ manifest: ManifestDetail; conflicts: number[] }> {
  return withTenantTransaction(orgId, async (client) => {
    const year = new Date().getUTCFullYear();
    const seq = await allocateManifestSeq(client, orgId, year);
    const manifestUid = buildManifestUid(input.sku, seq);
    const ins = await client.query<ManifestRow>(
      `INSERT INTO label_manifests
         (organization_id, manifest_uid, manifest_type, sku, sku_catalog_id,
          condition_grade, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
       RETURNING *`,
      [
        orgId,
        manifestUid,
        input.manifestType ?? 'PREBOX',
        input.sku ?? null,
        input.skuCatalogId ?? null,
        input.conditionGrade ?? null,
        input.notes ?? null,
        input.createdBy ?? null,
      ],
    );
    const manifestId = ins.rows[0].id;
    let conflicts: number[] = [];
    if (input.serialUnitIds?.length) {
      ({ conflicts } = await addItemsTx(client, orgId, manifestId, input.serialUnitIds));
    }
    const detail = await detailTx(client, orgId, manifestId);
    return { manifest: detail as ManifestDetail, conflicts };
  });
}

export async function getManifestDetail(
  manifestId: number,
  orgId: OrgId,
): Promise<ManifestDetail | null> {
  return withTenantTransaction(orgId, (client) => detailTx(client, orgId, manifestId));
}

/**
 * Resolve manifest detail by a numeric id OR a `KIT-…` manifest_uid (what a
 * scanned master label carries). Lets one GET endpoint serve both the app's
 * `?id=` links and a raw scan.
 */
export async function getManifestDetailByRef(
  ref: string | number,
  orgId: OrgId,
): Promise<ManifestDetail | null> {
  const raw = String(ref).trim();
  const asNum = Number(raw);
  const looksNumeric = Number.isFinite(asNum) && asNum > 0 && !/^KIT-/i.test(raw);
  return withTenantTransaction(orgId, async (client) => {
    if (looksNumeric) return detailTx(client, orgId, asNum);
    const m = await client.query<ManifestRow>(
      `SELECT id FROM label_manifests WHERE organization_id = $1 AND manifest_uid = $2 LIMIT 1`,
      [orgId, raw],
    );
    const found = m.rows[0];
    return found ? detailTx(client, orgId, found.id) : null;
  });
}

/** Add units to an OPEN manifest (combine). Skips + reports one-live conflicts. */
export async function addManifestItems(
  manifestId: number,
  serialUnitIds: number[],
  orgId: OrgId,
): Promise<{ manifest: ManifestDetail | null; added: number[]; conflicts: number[] }> {
  return withTenantTransaction(orgId, async (client) => {
    const open = await client.query<{ status: ManifestStatus }>(
      `SELECT status FROM label_manifests WHERE organization_id = $1 AND id = $2 LIMIT 1`,
      [orgId, manifestId],
    );
    if (!open.rows[0]) return { manifest: null, added: [], conflicts: [] };
    if (open.rows[0].status !== 'OPEN') {
      // Can't add to a sealed/dissolved manifest.
      return { manifest: await detailTx(client, orgId, manifestId), added: [], conflicts: serialUnitIds };
    }
    const { added, conflicts } = await addItemsTx(client, orgId, manifestId, serialUnitIds);
    return { manifest: await detailTx(client, orgId, manifestId), added, conflicts };
  });
}

/** Remove one unit from a manifest (split one out). */
export async function removeManifestItem(
  manifestId: number,
  serialUnitId: number,
  orgId: OrgId,
): Promise<{ manifest: ManifestDetail | null; removed: number }> {
  return withTenantTransaction(orgId, async (client) => {
    const del = await client.query(
      `DELETE FROM label_manifest_items
        WHERE organization_id = $1 AND manifest_id = $2 AND serial_unit_id = $3`,
      [orgId, manifestId, serialUnitId],
    );
    return { manifest: await detailTx(client, orgId, manifestId), removed: del.rowCount ?? 0 };
  });
}

/**
 * Seal an OPEN manifest → returns the sealed row + its manifest_uid to print.
 * Idempotent: sealing an already-SEALED manifest returns it unchanged; a
 * DISSOLVED manifest returns null (can't seal).
 */
export async function sealManifest(
  manifestId: number,
  orgId: OrgId,
): Promise<ManifestRow | null> {
  const upd = await tenantQuery<ManifestRow>(
    orgId,
    `UPDATE label_manifests
        SET status = 'SEALED', sealed_at = now(), updated_at = now()
      WHERE organization_id = $1 AND id = $2 AND status = 'OPEN'
      RETURNING *`,
    [orgId, manifestId],
  );
  if (upd.rows[0]) return upd.rows[0];
  // Already sealed → idempotent success; dissolved/not-found → null.
  const cur = await tenantQuery<ManifestRow>(
    orgId,
    `SELECT * FROM label_manifests WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, manifestId],
  );
  const row = cur.rows[0];
  return row && row.status === 'SEALED' ? row : null;
}

/**
 * Dissolve a manifest (split the kit back to singles): mark DISSOLVED and delete
 * its items so the units are free to re-manifest. Idempotent under retry.
 */
export async function dissolveManifest(
  manifestId: number,
  orgId: OrgId,
): Promise<ManifestRow | null> {
  return withTenantTransaction(orgId, async (client) => {
    const upd = await client.query<ManifestRow>(
      `UPDATE label_manifests
          SET status = 'DISSOLVED', updated_at = now()
        WHERE organization_id = $1 AND id = $2
        RETURNING *`,
      [orgId, manifestId],
    );
    if (!upd.rows[0]) return null;
    await client.query(
      `DELETE FROM label_manifest_items WHERE organization_id = $1 AND manifest_id = $2`,
      [orgId, manifestId],
    );
    return upd.rows[0];
  });
}
