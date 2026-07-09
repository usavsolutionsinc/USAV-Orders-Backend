/**
 * Inbound source registry — the code-side SoT for the `source_type` discriminator
 * shared by every polymorphic inbound table (inbound_purchase_order_links,
 * _mirror, _equivalence, _merge_log) and the receiving_lines.inbound_source_type
 * cache.
 *
 * Plan: docs/incoming-universal-purchase-orders-plan.md §2.3, §9.8.
 * Contract: .claude/rules/polymorphic-tables.md (named CHECK per discriminator).
 *
 * ⚠ MUST STAY IN SYNC WITH THE DB CHECKS. This list and the named CHECK
 * constraints in 2026-07-01k (links/mirror/equivalence/merge_log) + 2026-07-01l
 * (receiving_lines_inbound_source_type_chk) enumerate the SAME set. Adding a
 * source is a two-step, same-PR change: extend every CHECK via migration AND add
 * the slug here (+ its receiving_line_facts Zod schema when it carries a payload).
 *
 * Pure module — no DB, no Deps.
 */

/** Every inbound purchase source this schema recognizes. Order is display order. */
export const INBOUND_SOURCE_TYPES = ['zoho', 'ebay', 'amazon', 'manual'] as const;
export type InboundSourceType = (typeof INBOUND_SOURCE_TYPES)[number];

/** Human labels for pickers / badges (color/tone stays in the semantic tokens). */
export const INBOUND_SOURCE_LABELS: Record<InboundSourceType, string> = {
  zoho: 'Zoho',
  ebay: 'eBay',
  amazon: 'Amazon',
  manual: 'Manual',
};

/**
 * The `receiving_line_facts.fact_kind` that carries a source's marketplace
 * payload, when it has one. Zoho facts live in the narrow receiving_line_zoho
 * table (not the open facts registry), so 'zoho' maps to null here; 'manual' has
 * no marketplace payload. Extend when a new source registers a fact schema.
 */
export const INBOUND_SOURCE_FACT_KIND: Record<InboundSourceType, string | null> = {
  zoho: null,
  ebay: 'ebay_purchase',
  amazon: null, // register 'amazon_purchase' in the facts registry when Amazon inbound lands
  manual: null,
};

/** Type guard — true only for a registered inbound source. */
export function isRegisteredInboundSource(value: string): value is InboundSourceType {
  return (INBOUND_SOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Assert a source is registered, or throw. Use in writers before any SQL so an
 * unregistered `source_type` fails fast in the app layer (mirrors the app-side
 * validation mandate in the polymorphic contract) rather than as a raw DB CHECK
 * violation.
 */
export function assertRegisteredInboundSource(value: string): asserts value is InboundSourceType {
  if (!isRegisteredInboundSource(value)) {
    throw new Error(
      `inbound: unregistered source_type "${value}" (expected one of ${INBOUND_SOURCE_TYPES.join(', ')})`,
    );
  }
}
