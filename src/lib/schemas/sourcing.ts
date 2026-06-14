import { z } from 'zod';

// ─── Reusable building blocks (mirror sku-catalog.ts) ───────────────────────

const trimmed = z.string().trim();
const optNullableText = trimmed.min(1).nullable().optional();
const optPositiveId = z.number().int().positive().nullable().optional();
const optNonNegInt = z.number().int().nonnegative().nullable().optional();

const conditionEnum = z.enum(['new', 'refurbished', 'used', 'for_parts']);

// ─── PATCH /api/sourcing/alerts ──────────────────────────────────────────────

/**
 * Resolve / dismiss / progress a sourcing alert. `id` identifies the alert.
 * Transitioning to `resolved` or `dismissed` requires a `reason`
 * (sourcing.alert.resolve is in AUDIT_REASON_REQUIRED) — enforced in the route.
 */
export const SourcingAlertPatchBody = z
  .object({
    id: z.number().int().positive(),
    status: z.enum(['open', 'sourcing', 'resolved', 'dismissed']),
    reason: optNullableText,
  })
  .strict();

// ─── POST /api/sourcing/alerts ───────────────────────────────────────────────

/**
 * Manually open a demand row in the unified sourcing queue ("Source this").
 * Provide a `skuId` (catalog part) and/or a `searchQuery` (free-text target for
 * a product not yet in the catalog) — at least one is required. Always lands as
 * a `manual` demand_source. Idempotent for SKU-backed rows in the query layer.
 */
export const SourcingAlertCreateBody = z
  .object({
    skuId: optPositiveId,
    boseModelId: optPositiveId,
    searchQuery: optNullableText,
    alertType: z.enum(['manual']).optional(),
    severity: z.enum(['info', 'warn', 'critical']).optional(),
    reason: optNullableText,
    targetQty: z.number().int().positive().nullable().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.skuId || b.searchQuery?.trim()), {
    message: 'Provide a skuId or a searchQuery',
  });

// ─── /api/sourcing/saved-searches ────────────────────────────────────────────

const cadenceEnum = z.enum(['off', 'daily', 'weekly']);
const sourceEnum = z.enum(['ebay', 'amazon', 'google_shopping', 'zoho_po', 'distributor']);

/**
 * Create a standing (saved) sourcing search the scour watcher re-runs on a
 * cadence. `query` is required; everything else scopes/schedules it.
 */
export const SavedSearchCreateBody = z
  .object({
    query: trimmed.min(1, 'query is required'),
    label: optNullableText,
    skuId: optPositiveId,
    sourcingAlertId: optPositiveId,
    sources: z.array(sourceEnum).optional(),
    conditions: z.array(conditionEnum).optional(),
    maxPriceCents: optNonNegInt,
    cadence: cadenceEnum.optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

/** Update a saved search (edit the query/scope, retarget cadence, pause/resume). */
export const SavedSearchUpdateBody = z
  .object({
    query: trimmed.min(1).optional(),
    label: optNullableText,
    sources: z.array(sourceEnum).optional(),
    conditions: z.array(conditionEnum).optional(),
    maxPriceCents: optNonNegInt,
    cadence: cadenceEnum.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

// ─── POST /api/sourcing/search ───────────────────────────────────────────────

/**
 * Run a secondary-market (eBay Browse) search. At least one of `query` /
 * `modelNumber` must be present to build a meaningful search. Results are
 * normalized and returned; they are only persisted as candidates when
 * `save: true`. Rate-limited + logged to ebay_api_calls in the search lib.
 */
export const SourcingSearchBody = z
  .object({
    query: optNullableText,
    modelNumber: optNullableText,
    partRole: optNullableText,
    skuId: optPositiveId,
    boseModelId: optPositiveId,
    sourcingAlertId: optPositiveId,
    conditions: z.array(conditionEnum).optional(),
    maxPriceCents: optNonNegInt,
    limit: z.number().int().gte(1).lte(50).optional(),
    /** Persist the returned hits as sourcing_candidates (watchlist). */
    save: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Boolean(b.query?.trim() || b.modelNumber?.trim()), {
    message: 'Provide a query or modelNumber to search',
  });

// ─── POST /api/sourcing/candidates ───────────────────────────────────────────

/**
 * Save a candidate to the watchlist. `title` is required. eBay hits carry a
 * `source: 'ebay'` + `externalId` (the listing id) so re-saves dedupe on the
 * (source, external_id) unique index; manual candidates omit `externalId`.
 */
export const SourcingCandidateCreateBody = z
  .object({
    source: z.enum(['ebay', 'manual']).optional(),
    externalId: optNullableText,
    title: trimmed.min(1, 'title is required'),
    url: optNullableText,
    imageUrl: optNullableText,
    condition: conditionEnum.nullable().optional(),
    priceCents: optNonNegInt,
    shippingCents: optNonNegInt,
    currency: optNullableText,
    sellerName: optNullableText,
    skuId: optPositiveId,
    boseModelId: optPositiveId,
    sourcingAlertId: optPositiveId,
    supplierId: optPositiveId,
    status: z.enum(['candidate', 'watching', 'ordered', 'imported', 'rejected']).optional(),
    raw: z.record(z.string(), z.unknown()).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

// ─── PATCH /api/sourcing/candidates/[id] ─────────────────────────────────────

/**
 * Status transition + optional re-linking of a candidate (e.g. mark watching,
 * reject, or attach a resolved sku/model/supplier).
 */
export const SourcingCandidateUpdateBody = z
  .object({
    status: z.enum(['candidate', 'watching', 'ordered', 'imported', 'rejected']).optional(),
    skuId: optPositiveId,
    boseModelId: optPositiveId,
    supplierId: optPositiveId,
    sourcingAlertId: optPositiveId,
    notes: optNullableText,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  });

// ─── POST /api/sourcing/candidates/[id]/import ───────────────────────────────

/**
 * Import a candidate into inventory: upsert supplier → create a receiving row
 * (source_platform='ebay') → part_acquisitions(status='ordered'). Idempotent on
 * Idempotency-Key. `skuId` is required — the receiving/acquisition must land
 * against a real catalog part (the candidate may not have one resolved yet).
 */
export const SourcingImportBody = z
  .object({
    skuId: z.number().int().positive(),
    acquisitionCostCents: optNonNegInt,
    shippingCostCents: optNonNegInt,
    condition: conditionEnum.nullable().optional(),
    carrier: optNullableText,
    /** Override the supplier; otherwise derived from the candidate's seller. */
    supplierId: optPositiveId,
    reason: optNullableText,
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type SourcingAlertPatchInput = z.infer<typeof SourcingAlertPatchBody>;
export type SourcingAlertCreateInput = z.infer<typeof SourcingAlertCreateBody>;
export type SavedSearchCreateInput = z.infer<typeof SavedSearchCreateBody>;
export type SavedSearchUpdateInput = z.infer<typeof SavedSearchUpdateBody>;
export type SourcingSearchInput = z.infer<typeof SourcingSearchBody>;
export type SourcingCandidateCreateInput = z.infer<typeof SourcingCandidateCreateBody>;
export type SourcingCandidateUpdateInput = z.infer<typeof SourcingCandidateUpdateBody>;
export type SourcingImportInput = z.infer<typeof SourcingImportBody>;
