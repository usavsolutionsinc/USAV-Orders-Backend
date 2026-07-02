/**
 * Receiving typed-facts registry — the code-side governance for the
 * `receiving_line_facts(fact_kind, payload)` polymorphic store.
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 2) / §5.
 *
 * `fact_kind` is a free-TEXT discriminator in the DB (no CHECK), exactly like
 * `workflow_nodes.type`: the allowed set + the payload shape live HERE, in a code
 * registry, so a new org-custom kind needs no migration. The writer validates the
 * payload against the registered Zod schema, so `(fact_kind, payload)` is a true
 * tagged union rather than a junk drawer.
 *
 * Unknown (org-custom) kinds fall back to a permissive passthrough schema — the
 * fact is stored and loosely validated (must be a JSON object), so a tenant can
 * carry bespoke intake facts without a code change either. Promote a kind to a
 * strict schema here once its shape stabilizes.
 *
 * Pure module — no DB, no Deps. The DB helpers live in ./store.
 */

import { z } from 'zod';

/** Built-in fact kinds (the columns being extracted from receiving_lines). */
export const FACT_KINDS = [
  'marketplace_listing',
  'sourcing_import',
  'trade_in_valuation',
  'repair_service',
  'ebay_purchase',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Marketplace / triage provenance for unmatched lines (source_platform_pill, listing_url, …). */
export const marketplaceListingSchema = z.object({
  sourcePlatform: z.string().optional(),
  sourcePlatformPill: z.string().optional(),
  listingUrl: z.string().optional(),
  listingReference: z.string().optional(),
  skuPlatformIdRow: z.number().int().optional(),
});
export type MarketplaceListingFact = z.infer<typeof marketplaceListingSchema>;

/** Sourcing-import provenance (source_system, source_order_id, manual_entry_at). */
export const sourcingImportSchema = z.object({
  sourceSystem: z.string().optional(),
  sourceOrderId: z.string().optional(),
  manualEntryAt: z.string().optional(), // ISO-8601
});
export type SourcingImportFact = z.infer<typeof sourcingImportSchema>;

/** Trade-in valuation facts. */
export const tradeInValuationSchema = z.object({
  offeredAmountCents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  valuedByStaffId: z.number().int().optional(),
});
export type TradeInValuationFact = z.infer<typeof tradeInValuationSchema>;

/** Repair-service flag/ref (was receiving_lines.is_repair_service). */
export const repairServiceSchema = z.object({
  isRepairService: z.boolean().default(true),
  ticketRef: z.string().optional(),
});
export type RepairServiceFact = z.infer<typeof repairServiceSchema>;

/**
 * eBay buyer-purchase marketplace payload for an Incoming line sourced from an
 * eBay buyer account. The queryable operational facts (source_order_id, tracking,
 * platform_account_id) live on the spine / link row; this holds the eBay-specific
 * provenance. Universal Incoming plan §3.7.
 */
export const ebayPurchaseSchema = z.object({
  legacyOrderId: z.string().optional(),
  sellerUsername: z.string().optional(),
  purchaseOrderStatus: z.string().optional(),
  paymentStatus: z.string().optional(),
  listingUrl: z.string().optional(),
  /** Untranslated upstream status string, for debugging / display. */
  rawStatus: z.string().optional(),
});
export type EbayPurchaseFact = z.infer<typeof ebayPurchaseSchema>;

export interface FactKindDef {
  /** Human label for pickers / audit. */
  label: string;
  /** Payload validator; `parse` throws on a malformed write. */
  schema: z.ZodTypeAny;
}

const REGISTRY: Record<string, FactKindDef> = {
  marketplace_listing: { label: 'Marketplace listing', schema: marketplaceListingSchema },
  sourcing_import: { label: 'Sourcing import', schema: sourcingImportSchema },
  trade_in_valuation: { label: 'Trade-in valuation', schema: tradeInValuationSchema },
  repair_service: { label: 'Repair service', schema: repairServiceSchema },
  ebay_purchase: { label: 'eBay purchase', schema: ebayPurchaseSchema },
};

/** Org-custom / not-yet-promoted kinds: store any JSON object, validated loosely. */
const passthroughDef: FactKindDef = {
  label: 'Custom',
  schema: z.record(z.string(), z.unknown()),
};

/** True only for the built-in, strictly-typed kinds. */
export function isKnownFactKind(kind: string): kind is FactKind {
  return Object.prototype.hasOwnProperty.call(REGISTRY, kind);
}

/** The registered def for a kind, or the passthrough def for an org-custom kind. */
export function getFactDef(kind: string): FactKindDef {
  return REGISTRY[kind] ?? { ...passthroughDef, label: kind };
}

/** Validate + normalize a payload for a kind. Throws (ZodError) on a malformed write. */
export function parseFactPayload(kind: string, payload: unknown): Record<string, unknown> {
  return getFactDef(kind).schema.parse(payload) as Record<string, unknown>;
}

/** Non-throwing variant for callers that want to branch on validity. */
export function safeParseFactPayload(kind: string, payload: unknown) {
  return getFactDef(kind).schema.safeParse(payload);
}

/** All built-in kinds with their labels (for pickers). */
export function listKnownFactKinds(): Array<{ kind: FactKind; label: string }> {
  return FACT_KINDS.map((kind) => ({ kind, label: REGISTRY[kind].label }));
}
