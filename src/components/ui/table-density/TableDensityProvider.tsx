'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocalStorage } from '@/hooks/_storage';
import {
  DEFAULT_TABLE_DENSITY,
  DENSITY_PARAM,
  isTableDensity,
  tableDensityStorageKey,
  type TableDensity,
} from '@/lib/tables/table-density';

/**
 * Per-table row-density provider — mirrors {@link TableColumnConfigProvider}'s
 * shape. Wrap a station/queue table (by `tableId`) and its rows + the ⋮ menu read
 * the active density via {@link useTableDensity}.
 *
 * State model (matches the plan §3.2): the URL `?density=` is the shareable SoT,
 * with a per-`tableId` localStorage mirror so a table remembers its density when
 * the URL is clean. Reading prefers the URL param, then localStorage, then
 * `comfortable`. Writing updates BOTH (URL via `router.replace`, no scroll; the
 * default drops out of the URL to keep links clean). When no provider is mounted,
 * `useTableDensity` returns `comfortable` + a no-op setter — so rows that read it
 * outside a station table (the ~existing importers) are unaffected.
 */
interface TableDensityValue {
  density: TableDensity;
  setDensity: (next: TableDensity) => void;
}

const TableDensityContext = createContext<TableDensityValue | null>(null);

export function TableDensityProvider({
  tableId,
  /** Persist the active density in `?density=` too (shareable). Off → localStorage only. */
  urlSync = true,
  children,
}: {
  tableId: string;
  urlSync?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stored, setStored] = useLocalStorage<TableDensity>(
    tableDensityStorageKey(tableId),
    DEFAULT_TABLE_DENSITY,
  );

  const urlValue = urlSync ? searchParams.get(DENSITY_PARAM) : null;
  const density: TableDensity = isTableDensity(urlValue) ? urlValue : stored;

  const setDensity = useCallback(
    (next: TableDensity) => {
      setStored(next);
      if (!urlSync) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TABLE_DENSITY) params.delete(DENSITY_PARAM);
      else params.set(DENSITY_PARAM, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [setStored, urlSync, searchParams, router, pathname],
  );

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);
  return <TableDensityContext.Provider value={value}>{children}</TableDensityContext.Provider>;
}

/** Raw context read — prefer the {@link useTableDensity} hook, which also resolves classes. */
export function useTableDensityContext(): TableDensityValue {
  return useContext(TableDensityContext) ?? { density: DEFAULT_TABLE_DENSITY, setDensity: () => {} };
}
