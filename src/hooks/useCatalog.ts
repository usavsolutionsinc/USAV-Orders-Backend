'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogKeys, platformsQuery, typesQuery } from '@/lib/queries/catalog-queries';
import type { PlatformRow, TypeRow } from '@/lib/neon/catalog-queries';
import { SOURCE_PLATFORMS } from '@/lib/source-platform';
import { RECEIVING_TYPE_OPTS } from '@/components/sidebar/receiving/receiving-sidebar-shared';

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

/** Invalidate both catalog lists — call after a CRUD mutation. */
export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: catalogKeys.all });
  };
}
