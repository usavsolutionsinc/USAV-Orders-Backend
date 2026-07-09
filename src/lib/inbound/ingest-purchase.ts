/**
 * ingest-purchase — the ONE UPSERT that lands an external purchase onto the
 * Incoming spine, shared by the Phase 2 manual bridge import AND the Phase 3 API
 * sync (so bridge rows and API rows are byte-identical and upgrade in place).
 *
 * Plan: docs/incoming-universal-purchase-orders-plan.md §5.1 (Track B bridge), §5.3.
 *
 * This is HOW a purchasing account links to the Incoming display:
 *   buyer eBay account  →  ebay_accounts(account_role='buyer')
 *                       →  platform_accounts (integration_scope = account label)
 *   ingestPurchase()    →  resolves that platform_account_id
 *                       →  finds/creates ONE receiving_lines spine row (EXPECTED)
 *                       →  primary inbound_purchase_order_links (is_primary, the
 *                          account id) + ebay_purchase facts + reconcile mirror
 * so `/receiving?mode=incoming` shows the row with the eBay source badge and the
 * buyer account chip (rl.platform_account_id → platform_accounts join, §6.3).
 *
 * Idempotent: a re-import of the same (source, order, line) targets the SAME spine
 * row (the link natural key), and a per-(org,source,order) advisory lock serializes
 * concurrent imports so a first-time order can't create two spine rows.
 *
 * Deps-injected (default real impls) so unit tests run DB-free — the sub-writers
 * (upsertPurchaseLink / upsertInboundMirror) are injected and run on the SAME
 * transaction client, keeping the whole ingest atomic.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { assertRegisteredInboundSource, INBOUND_SOURCE_FACT_KIND, type InboundSourceType } from './source-registry';
import { upsertPurchaseLink, type TxClient } from './purchase-links';
import { upsertInboundMirror } from './mirror';

/** condition_grade_enum values (mirror of the DB enum). */
const CONDITION_GRADES = ['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
type ConditionGrade = (typeof CONDITION_GRADES)[number];

function normalizeConditionGrade(raw: unknown, fallback: ConditionGrade = 'BRAND_NEW'): ConditionGrade {
  if (raw == null) return fallback;
  const upper = String(raw).trim().toUpperCase().replace(/[\s-]/g, '_');
  return (CONDITION_GRADES as readonly string[]).includes(upper) ? (upper as ConditionGrade) : fallback;
}

export interface IngestPurchaseInput {
  /** Registered inbound source; defaults to 'ebay'. */
  sourceType?: string;
  /** External order id / PO# (eBay order id). Required. */
  sourceOrderId: string;
  sourceLineItemId?: string | null;
  /** The buyer/storefront account LABEL → resolves platform_accounts.integration_scope. */
  accountLabel?: string | null;

  // Spine item facts
  sku?: string | null;
  itemName?: string | null;
  quantityExpected?: number;
  conditionGrade?: string;

  // Marketplace payload (→ receiving_line_facts, e.g. ebay_purchase)
  legacyOrderId?: string | null;
  sellerUsername?: string | null;
  purchaseOrderStatus?: string | null;
  paymentStatus?: string | null;
  listingUrl?: string | null;
  rawStatus?: string | null;

  // Reconcile mirror snapshot (→ inbound_purchase_order_mirror)
  orderNumber?: string | null;
  vendorOrSellerName?: string | null;
  status?: string | null;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  poDate?: string | null;
  expectedDeliveryDate?: string | null;
  rawPayload?: unknown;
}

export interface IngestPurchaseResult {
  receivingLineId: number;
  created: boolean;
  platformAccountId: number | null;
  sourceType: string;
  sourceOrderId: string;
}

export interface IngestPurchaseDeps {
  withTx: <T>(orgId: OrgId, fn: (client: TxClient) => Promise<T>) => Promise<T>;
  upsertPurchaseLink: typeof upsertPurchaseLink;
  upsertInboundMirror: typeof upsertInboundMirror;
}

const defaultDeps: IngestPurchaseDeps = {
  withTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
  upsertPurchaseLink,
  upsertInboundMirror,
};

/** Only the keys with a real value — keeps the facts payload tight. */
function buildFactsPayload(input: IngestPurchaseInput): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [
    ['legacyOrderId', input.legacyOrderId],
    ['sellerUsername', input.sellerUsername],
    ['purchaseOrderStatus', input.purchaseOrderStatus],
    ['paymentStatus', input.paymentStatus],
    ['listingUrl', input.listingUrl],
    ['rawStatus', input.rawStatus],
  ];
  const payload: Record<string, unknown> = {};
  for (const [k, v] of entries) if (v != null && v !== '') payload[k] = v;
  return payload;
}

/**
 * Upsert one purchase into the Incoming spine. Returns the (created or reused)
 * receiving_line id plus the resolved buyer account. Throws when the source is
 * unregistered or sourceOrderId is blank.
 */
export async function ingestPurchase(
  orgId: OrgId,
  input: IngestPurchaseInput,
  deps: IngestPurchaseDeps = defaultDeps,
): Promise<IngestPurchaseResult> {
  const sourceType = (input.sourceType ?? 'ebay').trim().toLowerCase();
  assertRegisteredInboundSource(sourceType);

  const sourceOrderId = String(input.sourceOrderId ?? '').trim();
  if (!sourceOrderId) throw new Error('inbound: sourceOrderId is required');

  const sourceLineItemId = input.sourceLineItemId?.trim() || null;
  const quantityExpected = Math.max(1, Math.floor(Number(input.quantityExpected ?? 1)) || 1);
  const conditionGrade = normalizeConditionGrade(input.conditionGrade);
  const factKind = INBOUND_SOURCE_FACT_KIND[sourceType as InboundSourceType];
  const factsPayload = buildFactsPayload(input);

  return deps.withTx(orgId, async (client) => {
    // Serialize concurrent imports of the SAME external order so a first-time
    // order can't race two INSERTs into two spine rows. Transaction-scoped.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `inbound:${orgId}:${sourceType}:${sourceOrderId}:${sourceLineItemId ?? ''}`,
    ]);

    // Resolve the buyer/storefront account id from its label (platform slug === source).
    let platformAccountId: number | null = null;
    if (input.accountLabel?.trim()) {
      const acct = await client.query<{ id: number }>(
        `SELECT pa.id
           FROM platform_accounts pa
           JOIN platforms p
             ON p.id = pa.platform_id AND p.organization_id = pa.organization_id
          WHERE pa.organization_id = $1 AND p.slug = $2 AND pa.integration_scope = $3
          LIMIT 1`,
        [orgId, sourceType, input.accountLabel.trim()],
      );
      platformAccountId = acct.rows[0]?.id ?? null;
    }

    // Reconcile mirror snapshot (idempotent on org+source+order).
    await deps.upsertInboundMirror(
      orgId,
      {
        sourceType,
        sourceOrderId,
        platformAccountId,
        orderNumber: input.orderNumber ?? null,
        vendorOrSellerName: input.vendorOrSellerName ?? input.sellerUsername ?? null,
        status: input.status ?? input.purchaseOrderStatus ?? null,
        paymentStatus: input.paymentStatus ?? null,
        poDate: input.poDate ?? null,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        trackingNumber: input.trackingNumber ?? null,
        carrierCode: input.carrierCode ?? null,
        rawPayload: input.rawPayload ?? null,
      },
      { query: (async (_o: OrgId, sql: string, params?: ReadonlyArray<unknown>) => client.query(sql, params)) as never },
    );

    // Find the existing spine row for this identity (idempotent re-import).
    const existing = await client.query<{ receiving_line_id: number }>(
      `SELECT receiving_line_id
         FROM inbound_purchase_order_links
        WHERE organization_id = $1 AND source_type = $2 AND source_order_id = $3
          AND COALESCE(source_line_item_id, '') = COALESCE($4, '')
        ORDER BY receiving_line_id
        LIMIT 1`,
      [orgId, sourceType, sourceOrderId, sourceLineItemId],
    );

    let receivingLineId = existing.rows[0]?.receiving_line_id ?? null;
    const created = receivingLineId == null;

    if (receivingLineId == null) {
      // Create the pre-physical EXPECTED spine row (receiving_id NULL — no carton
      // scanned yet, same shape as a Zoho PO pre-staging line). zoho_item_id NULL
      // is allowed for marketplace lines since 2026-07-01l.
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO receiving_lines (
           receiving_id, zoho_item_id, sku, item_name,
           quantity_expected, quantity_received, workflow_status, condition_grade,
           receiving_type, source_system, source_order_id, source_line_item_id,
           inbound_source_type, platform_account_id, organization_id,
           manual_entry_at, created_at, updated_at
         ) VALUES (
           NULL, NULL, $1, $2,
           $3, 0, 'EXPECTED'::inbound_workflow_status_enum, $4::condition_grade_enum,
           'PO', $5, $6, $7,
           $5, $8, $9::uuid,
           NOW(), NOW(), NOW()
         )
         RETURNING id`,
        [
          input.sku?.trim() || null,
          input.itemName?.trim() || null,
          quantityExpected,
          conditionGrade,
          sourceType,
          sourceOrderId,
          sourceLineItemId,
          platformAccountId,
          orgId,
        ],
      );
      receivingLineId = inserted.rows[0].id;
    }

    // Primary purchase-identity link + spine-cache dual-write + marketplace facts,
    // all on this same transaction client.
    await deps.upsertPurchaseLink(
      orgId,
      {
        receivingLineId,
        sourceType,
        sourceOrderId,
        sourceLineItemId,
        isPrimary: true,
        platformAccountId,
        ...(factKind && Object.keys(factsPayload).length > 0
          ? { facts: { kind: factKind, payload: factsPayload } }
          : {}),
      },
      { withTx: (_o, fn) => fn(client) },
    );

    return { receivingLineId, created, platformAccountId, sourceType, sourceOrderId };
  });
}
