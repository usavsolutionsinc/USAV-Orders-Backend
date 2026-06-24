/**
 * resolve-shipment-for-scan.ts
 * ─────────────────────────────────────────────────────────────────
 * Single helper that maps a raw carrier scan/paste to the shipment
 * (`shipping_tracking_numbers`, "STN") it represents and the receiving carton
 * linked to it.
 *
 * Matching policy (see docs/new-additions/tracking-canonicalization-stn-plan.md §3.2):
 *
 *   1. EXACT normalized join — `stn.tracking_number_normalized = canonical`.
 *      STN's `UNIQUE (tracking_number_normalized)` makes this resolve at most
 *      one physical package, so it is the PREFERRED key.
 *   2. LAST-8 fallback — only when the exact join misses. Last-8 is lossy: the
 *      live DB has 15 collision groups (same trailing 8 digits, different real
 *      shipments), so this path requires an UNambiguous single carton and
 *      LOGS whenever it fires, demoting last-8 from "the key" to "a fallback".
 *
 * Replaces the scattered `RIGHT(regexp_replace(...),8)` STN match that used to
 * live inline in `receiving/lookup-po`. Deps-injectable so it unit-tests DB-free.
 */
import poolDefault from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { extractCanonicalTracking, last8FromStoredTracking } from '@/lib/tracking-format';
import type { OrgId } from '@/lib/tenancy/constants';

/** How the shipment was resolved — exact normalized key, lossy last-8, or no hit. */
export type ScanMatchKind = 'exact' | 'last8' | 'none';

export interface ShipmentScanResolution {
  /** STN id of the matched physical package, or null when nothing matched. */
  shipmentId: number | null;
  /** Linked receiving carton id (newest), or null when no carton is linked yet. */
  receivingId: number | null;
  /** `receiving.source` of the linked carton ('zoho_po' | 'unmatched' | …). */
  receivingSource: string | null;
  matchKind: ScanMatchKind;
}

interface ResolverRow {
  shipment_id: number;
  receiving_id: number | null;
  receiving_source: string | null;
}

export interface ResolveShipmentDeps {
  /**
   * Org-aware query. When `orgId` is present the default routes through
   * `tenantQuery` (sets `app.current_org` for RLS); otherwise it uses the raw
   * pool. Tests inject a fake that returns canned rows by inspecting the SQL.
   */
  query: <T>(orgId: OrgId | undefined, sql: string, params: unknown[]) => Promise<{ rows: T[] }>;
  /** Structured log emitted when the lossy last-8 fallback is used. */
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

const defaultDeps: ResolveShipmentDeps = {
  query: <T>(orgId: OrgId | undefined, sql: string, params: unknown[]) =>
    (orgId ? tenantQuery(orgId, sql, params) : poolDefault.query(sql, params)) as unknown as Promise<{
      rows: T[];
    }>,
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
};

const NONE: ShipmentScanResolution = {
  shipmentId: null,
  receivingId: null,
  receivingSource: null,
  matchKind: 'none',
};

/**
 * `receiving` is org-owned, so the STN→receiving join is tenant-scoped. The
 * predicate tolerates legacy NULL-org rows (door scans stamp org today, but
 * pre-2026-06 rows may not) so hardening the join can't silently drop them.
 * Param `$2` (exact) / `$3` (last8) carries the org id; omitted entirely when
 * no orgId is threaded so the un-scoped callers keep their original behavior.
 */
function orgPredicate(orgId: OrgId | undefined, param: string): string {
  return orgId ? `AND (r.organization_id = ${param} OR r.organization_id IS NULL)` : '';
}

/**
 * Resolve a raw scanned/pasted tracking value to its STN shipment + receiving
 * carton. Canonicalizes the input through the SoT normalizer first so a scanned
 * GS1/"96" FedEx barcode and the pasted human number converge before matching.
 */
export async function resolveShipmentForScan(
  raw: string,
  orgId?: OrgId,
  deps: ResolveShipmentDeps = defaultDeps,
): Promise<ShipmentScanResolution> {
  const canonical = extractCanonicalTracking(raw) || '';
  if (!canonical) return NONE;

  // ── 1. EXACT normalized join (preferred — STN normalized key is UNIQUE) ────
  // LEFT JOIN so an STN row with no carton still resolves the shipment; the org
  // predicate lives in the JOIN (not WHERE) so it can't nullify the left side.
  const exact = await deps.query<ResolverRow>(
    orgId,
    `SELECT stn.id AS shipment_id, r.id AS receiving_id, r.source AS receiving_source
       FROM shipping_tracking_numbers stn
       LEFT JOIN receiving r
         ON r.shipment_id = stn.id
         ${orgPredicate(orgId, '$2')}
      WHERE stn.tracking_number_normalized = $1
      ORDER BY r.id DESC NULLS LAST
      LIMIT 1`,
    orgId ? [canonical, orgId] : [canonical],
  );
  if (exact.rows.length > 0) {
    const row = exact.rows[0];
    return {
      shipmentId: Number(row.shipment_id),
      receivingId: row.receiving_id != null ? Number(row.receiving_id) : null,
      receivingSource: row.receiving_source ?? null,
      matchKind: 'exact',
    };
  }

  // ── 2. LAST-8 fallback (lossy — require a single carton, and log) ──────────
  const last8 = last8FromStoredTracking(canonical);
  if (last8.length < 8) return NONE;

  const fuzzy = await deps.query<ResolverRow>(
    orgId,
    `SELECT stn.id AS shipment_id, r.id AS receiving_id, r.source AS receiving_source
       FROM shipping_tracking_numbers stn
       JOIN receiving r ON r.shipment_id = stn.id
      WHERE (RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
          OR RIGHT(regexp_replace(stn.tracking_number_raw,        '\\D', '', 'g'), 8) = $1)
        ${orgPredicate(orgId, '$2')}
      ORDER BY r.id DESC
      LIMIT 2`,
    orgId ? [last8, orgId] : [last8],
  );

  // ≥2 distinct cartons on the same last-8 = a real collision → drop to Zoho
  // (the caller's PO-header disambiguation) rather than guess.
  if (fuzzy.rows.length !== 1) return NONE;

  const row = fuzzy.rows[0];
  deps.warn('[resolveShipmentForScan] last-8 fallback used — exact normalized miss', {
    last8,
    canonical,
    shipment_id: Number(row.shipment_id),
    receiving_id: row.receiving_id != null ? Number(row.receiving_id) : null,
  });
  return {
    shipmentId: Number(row.shipment_id),
    receivingId: row.receiving_id != null ? Number(row.receiving_id) : null,
    receivingSource: row.receiving_source ?? null,
    matchKind: 'last8',
  };
}
