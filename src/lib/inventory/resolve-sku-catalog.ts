import { queryOne } from '@/lib/neon-client';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { queuePendingSku } from '@/lib/inventory/pending-skus';
import { skuColorVariant, type SkuColorVariant } from '@/lib/inventory/sku-variant';

export interface ResolvedSkuCatalog {
  id: number;
  sku: string;
  product_title: string;
  gtin: string | null;
}

/**
 * A resolved catalog row PLUS the optional COLOR variant decoded from the input
 * SKU string (sku-reconciliation plan, Step B — color axis). Additive: the
 * resolution itself is unchanged; this just attaches a read-only variant view.
 */
export interface ResolvedSkuCatalogWithColor extends ResolvedSkuCatalog {
  /** Decoded color variant (`-B` → Black) or null when no confirmed color. */
  colorVariant: SkuColorVariant | null;
}

/**
 * Guarded variant-suffix strip (sku-reconciliation plan §6, step 4).
 *
 * Returns the bare base for an input that is a pure-numeric base (>= 4 digits) +
 * a dash + a pure-numeric counter suffix — the Ecwid listing-counter form
 * (`00010-2` → `00010`, `145-3` → `145`). Returns null for anything else.
 *
 * This is deliberately the **narrowest possible** pattern, because the two SKU
 * schemes collide (SoT: never broaden it). It can NEVER match — and so can never
 * mis-strip — these legitimately-distinct SKUs:
 *   - `-P-N` multi-part components (`00072-P-1`): the suffix is non-numeric (P),
 *     so the pattern fails; an explicit guard belts-and-suspenders this too.
 *   - color/condition suffixes (`-B`, `-W`, `-BK`, `-WH`, `-SW`): non-numeric
 *     suffix → no match.
 *   - bare numeric bases (`00010`): no dash → no match.
 *   - sub-4-digit bases (`123-5`): base too short → no match.
 */
const VARIANT_COUNTER_SUFFIX = /^[0-9]{4,}-[0-9]+$/;
const PROTECTED_PART_INDEX = /^[0-9]+-P-[0-9]+$/i;

export function strippableVariantBase(input: string): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  // Never collapse a protected -P-N part index, even defensively.
  if (PROTECTED_PART_INDEX.test(s)) return null;
  if (!VARIANT_COUNTER_SUFFIX.test(s)) return null;
  const base = s.replace(/-[0-9]+$/, '');
  return base && base !== s ? base : null;
}

/**
 * Injectable collaborators so the guard logic is unit-testable DB-free.
 * Defaults wire the real catalog lookup + the pending-skus queue.
 */
export interface ResolveSkuCatalogDeps {
  /** The base catalog lookup (explicit id → exact → leading-zero → crosswalk). */
  lookup: (
    skuInput: string,
    explicitId: number | null | undefined,
    orgId?: OrgId,
  ) => Promise<ResolvedSkuCatalog | null>;
  /** Best-effort enqueue of an unresolved SKU (the "create in Zoho" to-do). */
  queue: (rawSku: string, orgId?: OrgId) => Promise<void>;
}

const defaultDeps: ResolveSkuCatalogDeps = {
  lookup: lookupSkuCatalogRow,
  queue: async (rawSku) => {
    // Best-effort: a queue failure must never break a label/print/scan flow.
    try {
      await queuePendingSku({ rawSku, source: 'scan' });
    } catch (err) {
      console.warn('resolveSkuCatalogRow: queuePendingSku failed (non-fatal)', err);
    }
  },
};

/**
 * Resolve a sku_catalog row for a label/unit operation.
 *
 * Match strategy (shared by the print allocator and the reprint resolver so
 * the same input always lands on the same row):
 *   1. explicit `sku_catalog_id` → direct lookup.
 *   2. exact match on `sku` (case-insensitive, trimmed).
 *   3. leading-zero-stripped match (input "1103" finds catalog "01103").
 *   4. `sku_platform_ids` crosswalk (e.g. a scanned Ecwid SKU that maps to a
 *      different canonical sku_catalog.sku).
 *   5. NEW — guarded variant-suffix strip: a pure `NNNN-N` counter form retries
 *      against its bare base (`00010-2` → `00010`). Never fires on `-P-N` or
 *      non-numeric suffixes (see {@link strippableVariantBase}). Only when no
 *      explicit id was supplied.
 *   6. NEW — queue-on-miss: when nothing resolves, enqueue the raw SKU in the
 *      pending_skus "create in Zoho" to-do (best-effort; the null return and
 *      every prior code path are unchanged).
 *
 * Returns null when nothing matches.
 */
export async function resolveSkuCatalogRow(
  skuInput: string,
  explicitId?: number | null,
  orgId?: OrgId,
  deps: ResolveSkuCatalogDeps = defaultDeps,
): Promise<ResolvedSkuCatalog | null> {
  // 1–4. Existing resolution chain (behavior unchanged).
  const direct = await deps.lookup(skuInput, explicitId, orgId);
  if (direct) return direct;

  const trimmed = String(skuInput ?? '').trim();
  const hasExplicitId =
    explicitId != null && Number.isFinite(explicitId) && explicitId > 0;

  // 5. Guarded variant-suffix strip — only when resolving by SKU string (an
  //    explicit id short-circuits the base chain, so we don't second-guess it).
  if (!hasExplicitId) {
    const base = strippableVariantBase(trimmed);
    if (base) {
      const stripped = await deps.lookup(base, null, orgId);
      if (stripped) return stripped;
    }
  }

  // 6. Queue-on-miss (never guess; route the unresolved SKU to the to-do queue).
  if (trimmed) await deps.queue(trimmed, orgId);
  return null;
}

/**
 * Additive variant-aware resolver (sku-reconciliation plan, Step B — color axis).
 *
 * Resolves the catalog row exactly as {@link resolveSkuCatalogRow} (identical
 * inputs, identical resolution result — zero behavior change), then attaches the
 * COLOR variant decoded from the **input SKU string** (the suffix carries the
 * color; the resolved row is the canonical base). The color decode is read-only
 * and config-driven (`SKU_COLOR_SUFFIX_MAP`): a confirmed suffix (`-B`/`-W`)
 * yields `{ colorCode, colorLabel }`; an unconfirmed (`-N`/`-S`/`-SW`) or
 * non-color suffix yields `colorVariant: null`.
 *
 * Returns null only when the underlying resolution returns null (unchanged).
 */
export async function resolveSkuCatalogRowWithColor(
  skuInput: string,
  explicitId?: number | null,
  orgId?: OrgId,
  deps: ResolveSkuCatalogDeps = defaultDeps,
): Promise<ResolvedSkuCatalogWithColor | null> {
  const resolved = await resolveSkuCatalogRow(skuInput, explicitId, orgId, deps);
  if (!resolved) return null;
  return { ...resolved, colorVariant: skuColorVariant(skuInput) };
}

/**
 * The base catalog lookup (steps 1–4). Extracted verbatim from the original
 * `resolveSkuCatalogRow` body so behavior — including the explicit-id
 * short-circuit and org scoping — is byte-for-byte preserved.
 */
async function lookupSkuCatalogRow(
  skuInput: string,
  explicitId?: number | null,
  orgId?: OrgId,
): Promise<ResolvedSkuCatalog | null> {
  if (explicitId != null && Number.isFinite(explicitId) && explicitId > 0) {
    if (orgId) {
      const { rows } = await tenantQuery<ResolvedSkuCatalog>(
        orgId,
        `SELECT id, sku, product_title, gtin FROM sku_catalog
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [Math.floor(explicitId), orgId],
      );
      return rows[0] ?? null;
    }
    return await queryOne<ResolvedSkuCatalog>`
      SELECT id, sku, product_title, gtin FROM sku_catalog WHERE id = ${Math.floor(explicitId)} LIMIT 1`;
  }

  const trimmed = String(skuInput ?? '').trim();
  if (!trimmed) return null;

  if (orgId) {
    const { rows } = await tenantQuery<ResolvedSkuCatalog>(
      orgId,
      `SELECT id, sku, product_title, gtin FROM sku_catalog
        WHERE organization_id = $2
          AND (
            UPPER(TRIM(sku)) = UPPER(TRIM($1))
            OR regexp_replace(UPPER(TRIM(sku)), '^0+', '') = regexp_replace(UPPER(TRIM($1)), '^0+', '')
          )
        ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
        LIMIT 1`,
      [trimmed, orgId],
    );
    if (rows[0]) return rows[0];

    // Platform-sku crosswalk fallback (org-scoped on both junction + catalog).
    const { rows: xrows } = await tenantQuery<ResolvedSkuCatalog>(
      orgId,
      `SELECT sc.id, sc.sku, sc.product_title, sc.gtin
         FROM sku_platform_ids sp
         JOIN sku_catalog sc
           ON sc.id = sp.sku_catalog_id
          AND sc.organization_id = sp.organization_id
        WHERE sp.is_active = true
          AND sp.organization_id = $2
          AND (
            UPPER(TRIM(sp.platform_sku)) = UPPER(TRIM($1))
            OR regexp_replace(UPPER(TRIM(COALESCE(sp.platform_sku,''))), '^0+', '') = regexp_replace(UPPER(TRIM($1)), '^0+', '')
          )
        LIMIT 1`,
      [trimmed, orgId],
    );
    return xrows[0] ?? null;
  }

  const row = await queryOne<ResolvedSkuCatalog>`
    SELECT id, sku, product_title, gtin FROM sku_catalog
     WHERE UPPER(TRIM(sku)) = UPPER(TRIM(${trimmed}))
        OR regexp_replace(UPPER(TRIM(sku)), '^0+', '') = regexp_replace(UPPER(TRIM(${trimmed})), '^0+', '')
     ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM(${trimmed}))) DESC
     LIMIT 1`;
  if (row) return row;

  // Platform-sku crosswalk fallback.
  return await queryOne<ResolvedSkuCatalog>`
    SELECT sc.id, sc.sku, sc.product_title, sc.gtin
      FROM sku_platform_ids sp
      JOIN sku_catalog sc ON sc.id = sp.sku_catalog_id
     WHERE sp.is_active = true
       AND (
         UPPER(TRIM(sp.platform_sku)) = UPPER(TRIM(${trimmed}))
         OR regexp_replace(UPPER(TRIM(COALESCE(sp.platform_sku,''))), '^0+', '') = regexp_replace(UPPER(TRIM(${trimmed})), '^0+', '')
       )
     LIMIT 1`;
}
