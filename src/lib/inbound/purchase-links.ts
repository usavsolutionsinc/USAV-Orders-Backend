/**
 * inbound_purchase_order_links writer — the purchase-identity chokepoint.
 *
 * Plan: docs/incoming-universal-purchase-orders-plan.md §3.2.
 * Contract: .claude/rules/{backend-patterns,polymorphic-tables}.md.
 *
 * upsertPurchaseLink() does, in ONE tenant transaction:
 *   1. app-side validation — source registered, parent receiving_line exists for
 *      the org (existence check lives in the domain helper, not a DB trigger);
 *   2. upsert the link row (idempotent on ux_inbound_po_links_natural);
 *   3. when the link is primary, demote any other primary on that line and
 *      dual-write the receiving_lines transition cache (inbound_source_type,
 *      source_order_id, source_line_item_id, platform_account_id, source_system);
 *   4. co-write a typed marketplace fact (e.g. ebay_purchase) into
 *      receiving_line_facts when supplied — validated against the facts registry
 *      before any SQL runs.
 *
 * Deps-injected (default real impls) so unit tests run DB-free: the injected
 * `withTx` is faked with a client that captures queries. Same spirit as
 * src/lib/receiving/facts/store.ts (which injects `query`) and
 * src/lib/workflow/applyTransition.ts (which injects collaborators).
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { parseFactPayload } from '@/lib/receiving/facts/registry';
import { assertRegisteredInboundSource, type InboundSourceType } from './source-registry';

/** The minimal client surface a tenant transaction exposes (pg PoolClient shape). */
export interface TxClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Injectable collaborators (real impls by default; fakes in tests). */
export interface PurchaseLinksDeps {
  withTx: <T>(orgId: OrgId, fn: (client: TxClient) => Promise<T>) => Promise<T>;
}

const defaultDeps: PurchaseLinksDeps = {
  withTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
};

export interface UpsertPurchaseLinkInput {
  receivingLineId: number;
  sourceType: string;
  sourceOrderId: string;
  sourceLineItemId?: string | null;
  /** Marks the badge/account source shown in Incoming. Default false. */
  isPrimary?: boolean;
  platformAccountId?: number | null;
  /** Optional typed marketplace fact to co-write (validated against the facts registry). */
  facts?: { kind: string; payload: unknown };
  /**
   * When the link is primary, also refresh the receiving_lines transition cache.
   * Default true; pass false to write only the link (e.g. backfill jobs that set
   * the cache separately).
   */
  syncSpineCache?: boolean;
}

export interface PurchaseLinkRow {
  id: number;
  receiving_line_id: number;
  source_type: string;
  source_order_id: string;
  source_line_item_id: string | null;
  is_primary: boolean;
  platform_account_id: number | null;
}

/**
 * Upsert one purchase-identity link for a receiving line. Idempotent on
 * (org, line, source_type, source_order_id, COALESCE(source_line_item_id,'')).
 * Throws when the source is unregistered, the payload is malformed, or the parent
 * line doesn't exist for this org.
 */
export async function upsertPurchaseLink(
  orgId: OrgId,
  input: UpsertPurchaseLinkInput,
  deps: PurchaseLinksDeps = defaultDeps,
): Promise<PurchaseLinkRow> {
  assertRegisteredInboundSource(input.sourceType);

  // Validate the fact payload BEFORE opening the tx so a bad write fails fast.
  const validatedFacts =
    input.facts != null
      ? { kind: input.facts.kind, payload: parseFactPayload(input.facts.kind, input.facts.payload) }
      : null;

  const sourceType = input.sourceType as InboundSourceType;
  const lineItemId = input.sourceLineItemId ?? null;
  const isPrimary = input.isPrimary ?? false;
  const platformAccountId = input.platformAccountId ?? null;
  const syncSpineCache = input.syncSpineCache ?? true;

  return deps.withTx(orgId, async (client) => {
    // 1. Parent-existence validation (app-side, per the polymorphic contract).
    const parent = await client.query<{ id: number }>(
      `SELECT id FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
      [input.receivingLineId, orgId],
    );
    if (parent.rows.length === 0) {
      throw new Error(
        `inbound: receiving_line ${input.receivingLineId} not found for org ${orgId}`,
      );
    }

    // 2. One primary per line: demote any existing primary before upserting this
    //    one as primary, so ux_inbound_po_links_one_primary never collides.
    if (isPrimary) {
      await client.query(
        `UPDATE inbound_purchase_order_links
            SET is_primary = false, updated_at = now()
          WHERE organization_id = $1 AND receiving_line_id = $2 AND is_primary = true`,
        [orgId, input.receivingLineId],
      );
    }

    // 3. Upsert the link (expression-index conflict target matches ux_inbound_po_links_natural).
    const link = await client.query<PurchaseLinkRow>(
      `INSERT INTO inbound_purchase_order_links
         (organization_id, receiving_line_id, source_type, source_order_id,
          source_line_item_id, is_primary, platform_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, receiving_line_id, source_type, source_order_id,
                    COALESCE(source_line_item_id, ''))
       DO UPDATE SET is_primary = EXCLUDED.is_primary,
                     platform_account_id = COALESCE(EXCLUDED.platform_account_id, inbound_purchase_order_links.platform_account_id),
                     updated_at = now()
       RETURNING id, receiving_line_id, source_type, source_order_id,
                 source_line_item_id, is_primary, platform_account_id`,
      [
        orgId,
        input.receivingLineId,
        sourceType,
        input.sourceOrderId,
        lineItemId,
        isPrimary,
        platformAccountId,
      ],
    );

    // 4. Dual-write the spine transition cache from the primary link.
    if (isPrimary && syncSpineCache) {
      await client.query(
        `UPDATE receiving_lines
            SET inbound_source_type = $3,
                source_order_id     = $4,
                source_line_item_id = $5,
                source_system       = COALESCE(source_system, $3),
                platform_account_id = COALESCE($6, platform_account_id),
                updated_at          = now()
          WHERE id = $1 AND organization_id = $2`,
        [input.receivingLineId, orgId, sourceType, input.sourceOrderId, lineItemId, platformAccountId],
      );
    }

    // 5. Co-write the typed marketplace fact (idempotent on org+line+kind).
    if (validatedFacts) {
      await client.query(
        `INSERT INTO receiving_line_facts (organization_id, receiving_line_id, fact_kind, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (organization_id, receiving_line_id, fact_kind)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [orgId, input.receivingLineId, validatedFacts.kind, JSON.stringify(validatedFacts.payload)],
      );
    }

    return link.rows[0];
  });
}

/** All purchase-identity links for a line (Incoming display join + merge matcher). */
export async function listPurchaseLinksForLine(
  orgId: OrgId,
  receivingLineId: number,
  deps: PurchaseLinksDeps = defaultDeps,
): Promise<PurchaseLinkRow[]> {
  return deps.withTx(orgId, async (client) => {
    const r = await client.query<PurchaseLinkRow>(
      `SELECT id, receiving_line_id, source_type, source_order_id,
              source_line_item_id, is_primary, platform_account_id
         FROM inbound_purchase_order_links
        WHERE organization_id = $1 AND receiving_line_id = $2
        ORDER BY is_primary DESC, id`,
      [orgId, receivingLineId],
    );
    return r.rows;
  });
}

/**
 * The receiving_line ids that already have a link to a given external order —
 * the seek the eBay↔Zoho merge matcher runs before creating a duplicate spine
 * row (plan §4.2 / §4.3).
 */
export async function findLineIdsBySource(
  orgId: OrgId,
  sourceType: string,
  sourceOrderId: string,
  deps: PurchaseLinksDeps = defaultDeps,
): Promise<number[]> {
  assertRegisteredInboundSource(sourceType);
  return deps.withTx(orgId, async (client) => {
    const r = await client.query<{ receiving_line_id: number }>(
      `SELECT DISTINCT receiving_line_id
         FROM inbound_purchase_order_links
        WHERE organization_id = $1 AND source_type = $2 AND source_order_id = $3`,
      [orgId, sourceType, sourceOrderId],
    );
    return r.rows.map((row) => row.receiving_line_id);
  });
}
