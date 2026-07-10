/**
 * eBay buyer purchase → Incoming sync orchestration (Universal Incoming Track A,
 * plan §5.3). Per buyer account: delta-fetch purchase-order lines and land each
 * one on the Incoming spine via `ingestPurchase` (the SAME UPSERT the Phase 2
 * bridge uses), advancing a per-account cursor.
 *
 * The eBay-API-shape knowledge lives entirely behind the injected `fetchPurchases`
 * adapter (src/lib/ebay/purchase-client.ts), which is a documented no-op until
 * buy.order.readonly is approved — so this orchestration is complete and tested
 * now, and goes live by swapping the adapter, no rewrite.
 *
 * Dedup: this direction (eBay purchase arrives first) is collapsed against a Zoho
 * PO when that PO later syncs — the Zoho receiving-sync hook calls
 * mergeEbayLinesIntoZohoPo (plan §4.2, the common real-world order). Deps-injected
 * so unit tests run DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { ingestPurchase } from './ingest-purchase';
import {
  fetchBuyerPurchaseOrders,
  type BuyerAccountRef,
  type BuyerPurchaseLine,
} from '@/lib/ebay/purchase-client';

export interface SyncEbayPurchasesResult {
  orgId: OrgId;
  accounts: number;
  linesFetched: number;
  ingested: number;
  created: number;
  errors: string[];
}

export interface SyncEbayPurchasesDeps {
  listBuyerAccounts: (orgId: OrgId) => Promise<BuyerAccountRef[]>;
  fetchPurchases: (orgId: OrgId, account: BuyerAccountRef, sinceIso: string | null) => Promise<BuyerPurchaseLine[]>;
  ingest: typeof ingestPurchase;
  getCursor: (resource: string) => Promise<Date | null>;
  setCursor: (resource: string, at: Date) => Promise<void>;
  now: () => number;
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

const defaultDeps: SyncEbayPurchasesDeps = {
  listBuyerAccounts: defaultListBuyerAccounts,
  fetchPurchases: fetchBuyerPurchaseOrders,
  ingest: ingestPurchase,
  getCursor: getSyncCursor,
  setCursor: updateSyncCursor,
  now: () => Date.now(),
};

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sync every connected buyer account's purchases into Incoming for one org.
 * Per-account and per-line failures are isolated (collected in `errors`), so one
 * bad line never aborts the account and one bad account never aborts the org.
 * The cursor advances only after an account's pull is processed.
 */
export async function syncEbayPurchasesToReceiving(
  orgId: OrgId,
  deps: SyncEbayPurchasesDeps = defaultDeps,
): Promise<SyncEbayPurchasesResult> {
  const accounts = await deps.listBuyerAccounts(orgId);
  let linesFetched = 0;
  let ingested = 0;
  let created = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    const resource = `ebay_purchases:${orgId}:${account.accountName}`;
    const since = await deps.getCursor(resource);

    let lines: BuyerPurchaseLine[];
    try {
      lines = await deps.fetchPurchases(orgId, account, since ? since.toISOString() : null);
    } catch (e) {
      errors.push(`${account.accountName}: fetch failed: ${msg(e)}`);
      continue;
    }
    linesFetched += lines.length;

    for (const line of lines) {
      if (!line.sourceOrderId) {
        errors.push(`${account.accountName}: skipped a line with no order id`);
        continue;
      }
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
        ingested += 1;
        if (res.created) created += 1;
      } catch (e) {
        errors.push(`${account.accountName}/${line.sourceOrderId}: ${msg(e)}`);
      }
    }

    // Advance the cursor only after a successful fetch (including empty pulls).
    // Failed fetches `continue` above without moving `since`.
    try {
      await deps.setCursor(resource, new Date(deps.now()));
    } catch (e) {
      errors.push(`${account.accountName}: cursor update failed: ${msg(e)}`);
    }
  }

  return { orgId, accounts: accounts.length, linesFetched, ingested, created, errors };
}
