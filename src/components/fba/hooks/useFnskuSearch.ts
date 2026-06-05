'use client';

/**
 * Debounced FNSKU catalog search for the shipment editor.
 *
 * Replaces the editor's hand-rolled trio (fnskuQuery/fnskuResults/fnskuSearching)
 * + a manual setTimeout-ref debounce effect + raw fetch with a debounced
 * `useQuery`. The caller still owns the input value (it's form state); this hook
 * just turns a query string into results.
 */

import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks';
import { qk } from '@/queries/keys';

export interface FnskuSearchResult {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

const MIN_CHARS = 2;

export function useFnskuSearch(query: string, enabled: boolean) {
  const trimmed = query.trim();
  const debounced = useDebounce(trimmed, 250);
  const active = debounced.length >= MIN_CHARS ? debounced : '';

  const search = useQuery<FnskuSearchResult[]>({
    queryKey: qk.fba.fnskuSearch(active),
    enabled: enabled && active.length >= MIN_CHARS,
    queryFn: async () => {
      const res = await fetch(`/api/fba/fnskus/search?q=${encodeURIComponent(active)}&limit=8`);
      const data = await res.json();
      return data.success && Array.isArray(data.items) ? (data.items as FnskuSearchResult[]) : [];
    },
    placeholderData: (prev) => prev,
  });

  return {
    results: active ? (search.data ?? []) : [],
    // True while the user is still mid-debounce OR the request is in flight, so
    // the "Searching…" state shows immediately on keystroke (as it did before).
    searching: trimmed.length >= MIN_CHARS && (trimmed !== debounced || search.isFetching),
  };
}
