'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  catalogKeys,
  platformsQuery,
  platformAccountsQuery,
  typesQuery,
  workflowNodesQuery,
} from '@/lib/queries/catalog-queries';
import type { PlatformAccountRow, PlatformRow, TypeRow } from '@/lib/neon/catalog-queries';
import { SOURCE_PLATFORMS, sourcePlatformMeta, type SourcePlatformMeta } from '@/lib/source-platform';
import { RECEIVING_TYPE_OPTS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { receivingLabelTypeDisplay } from '@/lib/print/printReceivingLabel';
import { getOrderPlatformLabel } from '@/utils/order-platform';

/** A picker option resolved from the catalog (or the built-in fallback). */
export interface CatalogOption {
  value: string;
  label: string;
  /** Present only for DB-backed (custom-editable) rows. */
  id?: number;
  sortOrder?: number;
  /** Seeded built-in (hide-only) vs the org's own custom row. */
  isSystem?: boolean;
}

// Built-in fallback so every picker still works before the migration is applied
// / while the catalog query is loading. Mirrors the legacy constants 1:1.
const BUILTIN_PLATFORMS: CatalogOption[] = SOURCE_PLATFORMS.map((p) => ({ value: p.value, label: p.label }));
const BUILTIN_TYPES: CatalogOption[] = RECEIVING_TYPE_OPTS.map((t) => ({ value: t.value, label: t.label }));

/**
 * Org platform catalog. `options` are `{ value: slug, label }` for pills; falls
 * back to the built-in SOURCE_PLATFORMS list until the catalog has rows.
 */
export function usePlatformCatalog() {
  const q = useQuery(platformsQuery());
  const rows: PlatformRow[] = q.data ?? [];
  const options: CatalogOption[] = rows.length
    ? rows.map((r) => ({ value: r.slug, label: r.label, id: r.id, sortOrder: r.sort_order, isSystem: r.is_system }))
    : BUILTIN_PLATFORMS;
  return { ...q, rows, options };
}

/**
 * Org receiving-type catalog. `options` are `{ value: SLUG_UPPER, label }` to
 * match the uppercase `receiving_type` / `intake_type` the rest of the app
 * stores; falls back to RECEIVING_TYPE_OPTS until the catalog has rows.
 */
export function useReceivingTypeCatalog() {
  const q = useQuery(typesQuery());
  const rows: TypeRow[] = q.data ?? [];
  const options: CatalogOption[] = rows.length
    ? rows.map((r) => ({ value: r.slug.toUpperCase(), label: r.label, id: r.id, sortOrder: r.sort_order, isSystem: r.is_system }))
    : BUILTIN_TYPES;
  return { ...q, rows, options };
}

/**
 * Catalog-aware platform tone/label resolver. Returns `resolve(value)` →
 * {@link SourcePlatformMeta}: the org catalog's **label** wins (so a renamed or
 * custom platform reads correctly), the catalog `tone` overrides the text tone
 * when set, and everything else falls back to the built-in `sourcePlatformMeta`
 * (which also supplies the border tone the catalog doesn't store yet). A custom
 * slug with no built-in match resolves to its catalog label + neutral border
 * instead of "Unknown".
 */
export function usePlatformMeta(): (value: string | null | undefined) => SourcePlatformMeta {
  const { rows } = usePlatformCatalog();
  return useMemo(() => {
    const byValue = new Map(rows.map((r) => [r.slug, r]));
    return (value: string | null | undefined): SourcePlatformMeta => {
      const key = String(value ?? '').trim().toLowerCase();
      const builtin = sourcePlatformMeta(key);
      const row = byValue.get(key);
      if (!row) return builtin;
      return {
        value: key,
        label: row.label,
        text: row.tone ?? builtin.text,
        border: builtin.border,
      };
    };
  }, [rows]);
}

/**
 * Catalog-aware receiving-type label resolver. Returns `resolve(code)` → the
 * org catalog's label for that type slug (so a renamed or custom type reads
 * correctly), falling back to the built-in `receivingLabelTypeDisplay`. Empty
 * code → '' (no type shown). Mirror of {@link usePlatformMeta} for types.
 */
export function useReceivingTypeLabel(): (code: string | null | undefined) => string {
  const { rows } = useReceivingTypeCatalog();
  return useMemo(() => {
    const byCode = new Map(rows.map((r) => [r.slug.toUpperCase(), r.label]));
    return (code: string | null | undefined): string => {
      const key = String(code ?? '').trim().toUpperCase();
      if (!key) return '';
      return byCode.get(key) ?? receivingLabelTypeDisplay(key);
    };
  }, [rows]);
}

/**
 * Org storefront accounts (platform_accounts). `byPlatform` groups active rows
 * under their platform id for the accounts manager. No built-in fallback —
 * accounts are entirely org-defined (seeded from ebay_accounts + one default
 * per platform).
 */
export function usePlatformAccountCatalog(opts: { includeInactive?: boolean; platformId?: number } = {}) {
  const q = useQuery(platformAccountsQuery(opts));
  const rows: PlatformAccountRow[] = q.data ?? [];
  const byPlatform = useMemo(() => {
    const m = new Map<number, PlatformAccountRow[]>();
    for (const r of rows) {
      const list = m.get(r.platform_id) ?? [];
      list.push(r);
      m.set(r.platform_id, list);
    }
    return m;
  }, [rows]);
  return { ...q, rows, byPlatform };
}

/** Bindable workflow-graph nodes for the type editor's custom-flow picker. */
export function useWorkflowNodeOptions() {
  const q = useQuery(workflowNodesQuery());
  return { ...q, nodes: q.data ?? [] };
}

/**
 * Catalog-aware order-channel label resolver. Returns `resolve(orderId,
 * accountSource)` → the channel label, preferring the org catalog (so a renamed
 * or custom platform / storefront reads correctly) and falling back to the
 * built-in {@link getOrderPlatformLabel} pattern matcher. `account_source` is
 * hybrid-grain — an eBay account slug ('ebay-mk') or a platform slug
 * ('ecwid','fba') — so we match accounts first, then platforms. This is the
 * read-side unlock the plan defers to Phase 2 (orders.account_source → catalog
 * label across the order tables). The text column stays the cache.
 */
export function useOrderChannelLabel(): (
  orderId: string | null | undefined,
  accountSource: string | null | undefined,
) => string {
  const { rows: platforms } = usePlatformCatalog();
  const { rows: accounts } = usePlatformAccountCatalog();
  return useMemo(() => {
    const platformById = new Map(platforms.map((p) => [p.id, p]));
    const accountBySlug = new Map(accounts.map((a) => [a.slug.toLowerCase(), a]));
    const platformBySlug = new Map(platforms.map((p) => [p.slug.toLowerCase(), p]));
    return (orderId: string | null | undefined, accountSource: string | null | undefined): string => {
      const key = String(accountSource ?? '').trim().toLowerCase();
      if (key) {
        const acct = accountBySlug.get(key);
        const platform = acct ? platformById.get(acct.platform_id) : platformBySlug.get(key);
        if (platform) return platform.label;
      }
      return getOrderPlatformLabel(orderId, accountSource);
    };
  }, [platforms, accounts]);
}

/** Invalidate every catalog list — call after a CRUD mutation. */
export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: catalogKeys.all });
  };
}
