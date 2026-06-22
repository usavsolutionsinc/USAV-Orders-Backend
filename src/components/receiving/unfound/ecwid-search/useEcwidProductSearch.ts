'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DEBOUNCE_MS,
  MAX_RESULTS,
  type CatalogSearchField,
  type EcwidProductSearchPopoverProps,
  type SearchItem,
  type SearchResponse,
} from './ecwid-search-shared';

/**
 * Owns the Ecwid product-search popover's state: catalog search (debounced +
 * aborted), recent repair-service order load + client filter, the manual
 * title-only and manual repair-order entry flows, Escape-to-close, and the
 * select handlers that converge on `onSelect` → add-unmatched-line. Returns a
 * controller bag the thin popover shell + presentational pieces render from.
 */
export function useEcwidProductSearch({
  popoverMode,
  initialQuery = '',
  searchFieldOverride,
  onSelect,
  onClose,
}: EcwidProductSearchPopoverProps) {
  const [query, setQuery] = useState(initialQuery);
  const [searchField, setSearchField] = useState<CatalogSearchField>('title');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  /** Operator-entered title when the product is not in Ecwid (search mode only). */
  const [manualTitleMode, setManualTitleMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  // repair_service mode: client filter over the loaded recent list + a manual
  // order#-entry path for orders NOT in the recent list (the "custom manual
  // input" fallback). Both converge on the SAME onSelect → add-unmatched-line
  // persistence as picking a recent row, so manual == list-pick downstream.
  const [repairFilter, setRepairFilter] = useState('');
  const [repairManualMode, setRepairManualMode] = useState(false);
  const [manualOrderId, setManualOrderId] = useState('');

  const listboxId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Prevents double-submit while POST /api/receiving/add-unmatched-line runs. */
  const manualSubmitLockRef = useRef(false);

  // Reset manual-entry UI when switching between catalog search and repair list.
  useEffect(() => {
    setManualTitleMode(false);
    setManualTitle('');
    setManualSubmitting(false);
    manualSubmitLockRef.current = false;
    setRepairFilter('');
    setRepairManualMode(false);
    setManualOrderId('');
  }, [popoverMode]);

  // ─── Recent repair-service orders (Ecwid `-RS` SKUs) ─────────────────────────
  useEffect(() => {
    if (popoverMode !== 'repair_service') return;
    let cancelled = false;
    setItems([]);
    setError(null);
    setIsLoading(true);
    abortRef.current?.abort();

    fetch('/api/ecwid/recent-repair-orders?limit=30')
      .then(async (res) => {
        const body = (await res.json()) as SearchResponse;
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `load failed (${res.status})`);
        }
        if (!cancelled) setItems(body.items ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to load repair orders');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [popoverMode]);

  // ─── Catalog search with debounce + abort ───────────────────────────────────
  useEffect(() => {
    if (popoverMode !== 'search' || manualTitleMode) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      abortRef.current?.abort();
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setError(null);

      const url = new URL('/api/sku-catalog/search', window.location.origin);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('searchField', searchFieldOverride ?? searchField);
      url.searchParams.set('limit', String(MAX_RESULTS));

      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          const body = (await res.json()) as SearchResponse;
          if (!res.ok || !body.success) {
            throw new Error(body.error ?? `search failed (${res.status})`);
          }
          setItems(body.items ?? []);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          setItems([]);
          setError(err instanceof Error ? err.message : 'search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [popoverMode, query, searchField, searchFieldOverride, manualTitleMode]);

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Escape closes ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ─── Select handler ────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    async (item: SearchItem) => {
      const displaySku = item.sku ?? item.zoho_sku ?? '';
      if (!displaySku && !item.product_title) return;
      // Zoho-catalog search rows key on `sku_catalog.id` (the search borrows it),
      // whereas Ecwid title/SKU rows key on `sku_platform_ids.id`. Map each to
      // the right field so add-unmatched-line stores the correct FK.
      const isZohoCatalog = popoverMode === 'search' && searchFieldOverride === 'zoho_catalog';
      setSubmittingId(item.id);
      try {
        await onSelect({
          // For platform rows, the server resolves sku_catalog_id from
          // sku_platform_id_row at insert time; for Zoho rows we already have it.
          sku_platform_id_row: isZohoCatalog ? null : item.id,
          sku_catalog_id: isZohoCatalog ? item.id : null,
          sku: displaySku,
          item_name: item.product_title,
          image_url: item.image_url,
          ...(popoverMode === 'repair_service'
            ? {
                is_repair_service: true,
                ecwid_order_id: item.order_id ?? '',
                ecwid_product_url: item.product_url ?? null,
              }
            : {}),
        });
      } finally {
        setSubmittingId(null);
      }
    },
    [onSelect, popoverMode, searchFieldOverride],
  );

  const handleManualTitleSubmit = useCallback(async () => {
    const trimmed = manualTitle.trim();
    if (!trimmed) return;
    if (manualSubmitLockRef.current) return;
    manualSubmitLockRef.current = true;
    setManualSubmitting(true);
    try {
      await onSelect({
        sku_platform_id_row: null,
        sku_catalog_id: null,
        sku: '',
        item_name: trimmed,
        image_url: null,
      });
    } finally {
      manualSubmitLockRef.current = false;
      setManualSubmitting(false);
    }
  }, [manualTitle, onSelect]);

  // Client filter over the loaded recent repair list (the "search display").
  const visibleItems = useMemo(() => {
    if (popoverMode !== 'repair_service' || !repairFilter.trim()) return items;
    const q = repairFilter.trim().toLowerCase().replace(/^#/, '');
    return items.filter(
      (it) =>
        (it.order_id ?? '').toLowerCase().includes(q) ||
        (it.product_title ?? '').toLowerCase().includes(q) ||
        (it.sku ?? it.zoho_sku ?? '').toLowerCase().includes(q),
    );
  }, [items, popoverMode, repairFilter]);

  // Manual repair-order link — for an Ecwid order NOT in the recent list. Same
  // onSelect path as a list pick, so the carton link + per-line persistence are
  // identical; only the order# (and optional description) are operator-typed.
  const handleManualRepairSubmit = useCallback(async () => {
    const orderId = manualOrderId.trim().replace(/^#/, '');
    if (!orderId) return;
    if (manualSubmitLockRef.current) return;
    const title = manualTitle.trim() || `Repair service · order #${orderId}`;
    manualSubmitLockRef.current = true;
    setManualSubmitting(true);
    try {
      await onSelect({
        sku_platform_id_row: null,
        sku_catalog_id: null,
        sku: '',
        item_name: title,
        image_url: null,
        is_repair_service: true,
        ecwid_order_id: orderId,
        ecwid_product_url: null,
      });
    } finally {
      manualSubmitLockRef.current = false;
      setManualSubmitting(false);
    }
  }, [manualOrderId, manualTitle, onSelect]);

  const placeholder = useMemo(
    () =>
      searchFieldOverride
        ? 'Search product name or SKU…'
        : searchField === 'title'
          ? 'Search Ecwid product title…'
          : 'Search Ecwid SKU…',
    [searchField, searchFieldOverride],
  );

  const dialogAria =
    popoverMode === 'repair_service'
      ? 'Recent Ecwid repair-service orders'
      : manualTitleMode
        ? 'Enter product title manually'
        : 'Search Ecwid products';

  return {
    // raw state + setters
    query, setQuery,
    searchField, setSearchField,
    items, setItems,
    isLoading, setIsLoading,
    error, setError,
    submittingId,
    manualTitleMode, setManualTitleMode,
    manualTitle, setManualTitle,
    manualSubmitting,
    repairFilter, setRepairFilter,
    repairManualMode, setRepairManualMode,
    manualOrderId, setManualOrderId,
    // refs + ids
    listboxId,
    abortRef,
    // derived
    visibleItems,
    placeholder,
    dialogAria,
    // handlers
    handleSelect,
    handleManualTitleSubmit,
    handleManualRepairSubmit,
    // passthrough
    popoverMode,
    searchFieldOverride,
  };
}

export type EcwidProductSearchController = ReturnType<typeof useEcwidProductSearch>;
