/**
 * Per-order inbound marketplace resync — re-pull one eBay (or future Amazon)
 * buyer purchase onto the Incoming spine and re-poll its carrier shipment.
 *
 * Universal Incoming §7.3 / §9.4: the Incoming details panel "Resync" affordance
 * for non-Zoho rows. Track A eBay Buy API is a no-op until buy.order.readonly is
 * approved; until then we still re-poll tracking and surface actionable errors
 * (flag off, source disabled, no buyer account).
 *
 * Deps-injected so unit tests run DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { isIncomingUniversal } from '@/lib/feature-flags';
import { syncShipment } from '@/lib/shipping/sync-shipment';
import { resolveInboundSettings, isInboundSourceEnabled } from './org-settings';
import {
  syncEbayPurchasesToReceiving,
  type SyncEbayPurchasesResult,
} from './sync-ebay-purchases';
import {
  fetchBuyerPurchaseOrders,
  type BuyerAccountRef,
  type BuyerPurchaseLine,
} from '@/lib/ebay/purchase-client';
import { ingestPurchase } from './ingest-purchase';
import { getSyncCursor } from '@/lib/sync-cursors';
import { assertRegisteredInboundSource } from './source-registry';

export interface SyncOneInboundInput {
  sourceType: string;
  sourceOrderId: string;
  /** Buyer account label when known (narrows the account sweep). */
  accountLabel?: string | null;
}

export interface SyncOneInboundMarketplaceResult {
  ingested: number;
  created: number;
  linesFetched: number;
  accounts: number;
  errors: string[];
}

export interface SyncOneInboundShipmentResult {
  polled: boolean;
  status?: string | null;
  error?: string | null;
}

export interface SyncOneInboundResult {
  ok: boolean;
  sourceType: string;
  sourceOrderId: string;
  marketplace: SyncOneInboundMarketplaceResult | null;
  shipment: SyncOneInboundShipmentResult;
  /** Operator-facing note when nothing changed or API is not live yet. */
  note: string | null;
  error: string | null;
}

export interface SyncOneInboundDeps {
  isUniversalEnabled: (orgId: OrgId) => Promise<boolean>;
  resolveSettings: typeof resolveInboundSettings;
  listBuyerAccounts: (orgId: OrgId) => Promise<BuyerAccountRef[]>;
  fetchPurchases: typeof fetchBuyerPurchaseOrders;
  ingest: typeof ingestPurchase;
  getCursor: typeof getSyncCursor;
  syncAllEbay: typeof syncEbayPurchasesToReceiving;
  findShipmentId: (orgId: OrgId, sourceType: string, sourceOrderId: string) => Promise<number | null>;
  pollShipment: typeof syncShipment;
}

async function defaultListBuyerAccounts(orgId: OrgId): Promise<BuyerAccountRef[]> {
  const r = await tenantQuery<{ account_name: string }>(
    orgId,
    `SELECT account_name
       FROM ebay_accounts
      WHERE organization_id = $1
        AND account_role = 'buyer'
        AND is_active = true
        AND (platform = 'EBAY' OR platform IS NULL)
      ORDER BY account_name`,
    [orgId],
  );
  return r.rows.map((row) => ({ accountName: row.account_name }));
}

async function defaultFindShipmentId(
  orgId: OrgId,
  sourceType: string,
  sourceOrderId: string,
): Promise<number | null> {
  const r = await tenantQuery<{ shipment_id: number | null }>(
    orgId,
    `SELECT r.shipment_id
       FROM inbound_purchase_order_links l
       JOIN receiving_lines rl ON rl.id = l.receiving_line_id
       LEFT JOIN receiving r ON r.id = rl.receiving_id
      WHERE l.organization_id = $1
        AND l.source_type = $2
        AND l.source_order_id = $3
        AND rl.organization_id = $1
      ORDER BY l.is_primary DESC, l.id ASC
      LIMIT 1`,
    [orgId, sourceType, sourceOrderId],
  );
  return r.rows[0]?.shipment_id ?? null;
}

function lineMatchesOrder(line: BuyerPurchaseLine, orderId: string): boolean {
  const id = orderId.trim();
  if (!id) return false;
  return (
    line.sourceOrderId === id
    || (line.legacyOrderId != null && line.legacyOrderId === id)
    || (line.orderNumber != null && line.orderNumber === id)
  );
}

const defaultDeps: SyncOneInboundDeps = {
  isUniversalEnabled: isIncomingUniversal,
  resolveSettings: resolveInboundSettings,
  listBuyerAccounts: defaultListBuyerAccounts,
  fetchPurchases: fetchBuyerPurchaseOrders,
  ingest: ingestPurchase,
  getCursor: getSyncCursor,
  syncAllEbay: syncEbayPurchasesToReceiving,
  findShipmentId: defaultFindShipmentId,
  pollShipment: syncShipment,
};

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function syncEbayOrderTargeted(
  orgId: OrgId,
  input: SyncOneInboundInput,
  deps: SyncOneInboundDeps,
): Promise<SyncOneInboundMarketplaceResult> {
  const orderId = input.sourceOrderId.trim();
  let accounts = await deps.listBuyerAccounts(orgId);
  const label = input.accountLabel?.trim();
  if (label) accounts = accounts.filter((a) => a.accountName === label);

  const out: SyncOneInboundMarketplaceResult = {
    accounts: accounts.length,
    linesFetched: 0,
    ingested: 0,
    created: 0,
    errors: [],
  };

  if (accounts.length === 0) {
    out.errors.push(
      label
        ? `No active eBay buyer account "${label}" is connected.`
        : 'No connected eBay buyer accounts — add one under Settings → Integrations.',
    );
    return out;
  }

  for (const account of accounts) {
    const resource = `ebay_purchases:${orgId}:${account.accountName}`;
    const since = await deps.getCursor(resource);
    let lines: BuyerPurchaseLine[];
    try {
      lines = await deps.fetchPurchases(orgId, account, since ? since.toISOString() : null);
    } catch (e) {
      out.errors.push(`${account.accountName}: fetch failed: ${msg(e)}`);
      continue;
    }
    const matches = lines.filter((l) => lineMatchesOrder(l, orderId));
    out.linesFetched += matches.length;

    for (const line of matches) {
      try {
        const res = await deps.ingest(orgId, {
          sourceType: 'ebay',
          accountLabel: account.accountName,
          sourceOrderId: line.sourceOrderId,
          sourceLineItemId: line.sourceLineItemId ?? null,
          sku: line.sku ?? null,
          itemName: line.itemName ?? null,
          quantityExpected: line.quantity ?? 1,
          conditionGrade: line.conditionGrade ?? undefined,
          legacyOrderId: line.legacyOrderId ?? null,
          sellerUsername: line.sellerUsername ?? null,
          purchaseOrderStatus: line.purchaseOrderStatus ?? null,
          paymentStatus: line.paymentStatus ?? null,
          listingUrl: line.listingUrl ?? null,
          orderNumber: line.orderNumber ?? line.sourceOrderId,
          vendorOrSellerName: line.vendorOrSellerName ?? line.sellerUsername ?? null,
          trackingNumber: line.trackingNumber ?? null,
          carrierCode: line.carrierCode ?? null,
        });
        out.ingested += 1;
        if (res.created) out.created += 1;
      } catch (e) {
        out.errors.push(`${account.accountName}/${line.sourceOrderId}: ${msg(e)}`);
      }
    }
  }

  // When the Buy API is still a no-op, fall back to the org-wide delta sync so
  // the operator's click still runs the same pipeline the cron uses.
  if (out.linesFetched === 0 && out.ingested === 0) {
    const bulk: SyncEbayPurchasesResult = await deps.syncAllEbay(orgId);
    out.linesFetched = bulk.linesFetched;
    out.ingested = bulk.ingested;
    out.created = bulk.created;
    if (bulk.errors.length) out.errors.push(...bulk.errors);
  }

  return out;
}

/**
 * Re-sync one marketplace inbound order: pull from linked buyer accounts, then
 * re-poll carrier tracking when a shipment is attached.
 */
export async function syncOneInboundPurchase(
  orgId: OrgId,
  input: SyncOneInboundInput,
  deps: SyncOneInboundDeps = defaultDeps,
): Promise<SyncOneInboundResult> {
  const sourceType = input.sourceType.trim().toLowerCase();
  const sourceOrderId = input.sourceOrderId.trim();

  try {
    assertRegisteredInboundSource(sourceType);
  } catch (e) {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: msg(e),
    };
  }

  if (!sourceOrderId) {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: 'source_order_id is required',
    };
  }

  if (!(await deps.isUniversalEnabled(orgId))) {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: 'Universal Incoming is not enabled for this organization.',
    };
  }

  const settings = await deps.resolveSettings(orgId);
  if (!isInboundSourceEnabled(settings, sourceType)) {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: `Inbound source "${sourceType}" is not enabled for this organization.`,
    };
  }

  let marketplace: SyncOneInboundMarketplaceResult | null = null;
  let note: string | null = null;

  if (sourceType === 'ebay') {
    marketplace = await syncEbayOrderTargeted(orgId, input, deps);
    if (marketplace.linesFetched === 0 && marketplace.ingested === 0) {
      note = 'eBay Buy Order API is not live yet — no new lines from the marketplace. Tracking was re-polled if present; use Import eBay order to bridge manually.';
    }
  } else if (sourceType === 'amazon') {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: 'Amazon inbound purchase sync is not available yet.',
    };
  } else {
    return {
      ok: false,
      sourceType,
      sourceOrderId,
      marketplace: null,
      shipment: { polled: false },
      note: null,
      error: `Automatic resync is not supported for inbound source "${sourceType}".`,
    };
  }

  let shipment: SyncOneInboundShipmentResult = { polled: false };
  const shipmentId = await deps.findShipmentId(orgId, sourceType, sourceOrderId);
  if (shipmentId != null) {
    try {
      const r = await deps.pollShipment({ shipmentId });
      shipment = r.ok
        ? { polled: true, status: r.status ?? null }
        : { polled: false, error: r.error ?? r.errorCode ?? 'sync failed' };
    } catch (e) {
      shipment = { polled: false, error: msg(e) };
    }
  }

  const hardError = marketplace.errors.find((e) => /No connected eBay buyer/.test(e))
    ?? (marketplace.accounts === 0 ? marketplace.errors[0] : null);

  const ok = !hardError && (marketplace.ingested > 0 || shipment.polled || Boolean(note));

  return {
    ok,
    sourceType,
    sourceOrderId,
    marketplace,
    shipment,
    note,
    error: hardError,
  };
}
