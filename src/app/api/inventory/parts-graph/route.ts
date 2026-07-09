import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { parsePartSku, normalizeBase } from '@/lib/inventory/part-sku';
import { listPartLinks } from '@/lib/inventory/part-links';

/**
 * GET /api/inventory/parts-graph
 *
 * Derives the "parts graph" purely from the Zoho `items` mirror (Zoho is the
 * source of truth; this is a read-only enrichment, no local relationship state).
 *
 * Every active item whose SKU carries the `-P` flag is classified as a PART and
 * grouped:
 *
 *   base (whole unit code)
 *     └─ logical part (base + color + condition; stock index collapsed)
 *          └─ N stock-instance SKUs (the -1/-2/-3 dedups)
 *
 * Non-part items whose SKU equals a base code are surfaced as the base node's
 * "candidate parent" — UNVERIFIED. This run does NOT assert any parent↔child
 * link; pairing is a later, manual phase.
 *
 * Never crosses into `sku_catalog` — `items` is an independent SKU scheme.
 */

interface InstanceSku {
  sku: string;
  name: string;
  stockOnHand: number;
  stockAvailable: number;
}

type ReviewState = 'unreviewed' | 'confirmed' | 'not_a_part';

interface AssignedParent {
  linkId: number;
  parentItemId: string | null;
  parentSku: string | null;
  parentName: string | null;
  qty: number;
}

interface LogicalPart {
  logicalKey: string;
  logicalLabel: string;
  base: string;
  colorLabel: string | null;
  conditionLabel: string | null;
  unknownTokens: string[];
  instanceCount: number;
  stockOnHand: number;
  stockAvailable: number;
  skus: InstanceSku[];
  // Pairing state (from part_links). Derived: a part is reviewed iff it has a link.
  reviewState: ReviewState;
  assignedParents: AssignedParent[];
  notAPartLinkId: number | null;
}

interface PartsBase {
  base: string;
  /** Non-part item that matches this base code — an UNVERIFIED candidate parent. */
  baseUnit: { itemId: string; sku: string; name: string } | null;
  partCount: number;
  totalInstances: number;
  totalStockOnHand: number;
  parts: LogicalPart[];
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const GET = withAuth(
  async (_request: NextRequest, ctx) => {
    try {
      const orgId = ctx.organizationId;

      const result = await tenantQuery(
        orgId,
        `SELECT id, sku, name, quantity_on_hand, quantity_available
           FROM items
          WHERE organization_id = $1
            AND status = 'active'
            AND sku IS NOT NULL
            AND TRIM(sku) <> ''`,
        [orgId],
      );

      const rows = result.rows as Array<{
        id: string;
        sku: string;
        name: string | null;
        quantity_on_hand: string | number | null;
        quantity_available: string | number | null;
      }>;

      // Index non-part items by normalized base so we can attach a candidate
      // parent (leading-zero tolerant).
      const nonPartByBase = new Map<string, { itemId: string; sku: string; name: string }>();
      for (const r of rows) {
        const parsed = parsePartSku(r.sku);
        if (!parsed.isPart) {
          const key = normalizeBase(r.sku);
          if (key && !nonPartByBase.has(key)) {
            nonPartByBase.set(key, { itemId: r.id, sku: r.sku, name: r.name ?? '' });
          }
        }
      }

      const bases = new Map<string, PartsBase>();
      let partSkuCount = 0;
      let unclassifiedSkuCount = 0;

      for (const r of rows) {
        const parsed = parsePartSku(r.sku);
        if (!parsed.isPart || !parsed.base || !parsed.logicalKey) {
          unclassifiedSkuCount += 1;
          continue;
        }
        partSkuCount += 1;

        const onHand = toNum(r.quantity_on_hand);
        const available = toNum(r.quantity_available);

        let base = bases.get(parsed.base);
        if (!base) {
          base = {
            base: parsed.base,
            baseUnit: nonPartByBase.get(normalizeBase(parsed.base)) ?? null,
            partCount: 0,
            totalInstances: 0,
            totalStockOnHand: 0,
            parts: [],
          };
          bases.set(parsed.base, base);
        }

        let part = base.parts.find((p) => p.logicalKey === parsed.logicalKey);
        if (!part) {
          part = {
            logicalKey: parsed.logicalKey,
            logicalLabel: parsed.logicalLabel ?? parsed.base,
            base: parsed.base,
            colorLabel: parsed.colorLabel,
            conditionLabel: parsed.conditionLabel,
            unknownTokens: parsed.unknownTokens,
            instanceCount: 0,
            stockOnHand: 0,
            stockAvailable: 0,
            skus: [],
            reviewState: 'unreviewed',
            assignedParents: [],
            notAPartLinkId: null,
          };
          base.parts.push(part);
          base.partCount += 1;
        }

        part.instanceCount += 1;
        part.stockOnHand += onHand;
        part.stockAvailable += available;
        part.skus.push({ sku: r.sku, name: r.name ?? '', stockOnHand: onHand, stockAvailable: available });

        base.totalInstances += 1;
        base.totalStockOnHand += onHand;
      }

      // Stable, human-friendly ordering: by base code, then by part label.
      const orderedBases = Array.from(bases.values()).sort((a, b) =>
        a.base.localeCompare(b.base, undefined, { numeric: true }),
      );
      for (const b of orderedBases) {
        b.parts.sort((a, c) => a.logicalLabel.localeCompare(c.logicalLabel, undefined, { numeric: true }));
        for (const p of b.parts) p.skus.sort((x, y) => x.sku.localeCompare(y.sku, undefined, { numeric: true }));
      }

      // Fold in the SaaS-owned pairing state (part_links), keyed on the logical
      // part. A part is reviewed iff it has a link; confirmed links carry parents.
      const partByKey = new Map<string, LogicalPart>();
      for (const b of orderedBases) for (const p of b.parts) partByKey.set(p.logicalKey, p);

      // Degrade-not-fail: the pairing table is optional. Before the 2026-06-28g
      // migration is applied (or if it errors) the derived parts view still
      // renders — every part just reads as unreviewed.
      let links: Awaited<ReturnType<typeof listPartLinks>> = [];
      try {
        links = await listPartLinks(orgId);
      } catch (err) {
        console.warn('parts-graph: part_links unavailable, rendering without pairing state', err);
      }
      for (const link of links) {
        const part = partByKey.get(link.child_logical_key);
        if (!part) continue; // a link whose child no longer exists in the catalog
        if (link.status === 'not_a_part') {
          part.reviewState = 'not_a_part';
          part.notAPartLinkId = link.id;
        } else {
          part.reviewState = 'confirmed';
          part.assignedParents.push({
            linkId: link.id,
            parentItemId: link.parent_item_id,
            parentSku: link.parent_sku,
            parentName: link.parent_name,
            qty: link.qty,
          });
        }
      }

      let reviewedCount = 0;
      let notAPartCount = 0;
      for (const p of partByKey.values()) {
        if (p.reviewState !== 'unreviewed') reviewedCount += 1;
        if (p.reviewState === 'not_a_part') notAPartCount += 1;
      }

      return NextResponse.json({
        success: true,
        bases: orderedBases,
        summary: {
          baseCount: orderedBases.length,
          logicalPartCount: partByKey.size,
          partSkuCount,
          unclassifiedSkuCount,
          reviewedCount,
          needsReviewCount: partByKey.size - reviewedCount,
          notAPartCount,
        },
      });
    } catch (error: any) {
      console.error('parts-graph error', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.view' },
);
