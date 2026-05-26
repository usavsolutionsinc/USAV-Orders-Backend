'use client';

import { useQuery } from '@tanstack/react-query';

export interface LabelPrintFeedItem {
  id: number;
  printed_at: string;
  staff_id: number | null;
  staff_name: string | null;
  sku: string | null;
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  unit_id: string | null;
  gtin: string | null;
  symbology: string | null;
  serial_count: number | null;
  print_class: string | null;
  serial_unit_id: number | null;
  serial_number: string | null;
  current_status: string | null;
  current_location: string | null;
}

/**
 * Recently-printed label feed, backed by `station_activity_logs` rows
 * written by POST /api/post-multi-sn. Replaces the per-device localStorage
 * `useLabelRecents` for the Labels → Recent sub-view (the localStorage
 * version still drives the print workspace's RecentsStrip and the
 * pre-search recents pinned at the top of the Products sub-view).
 */
export function useLabelPrintFeed(limit = 50) {
  return useQuery<LabelPrintFeedItem[]>({
    queryKey: ['labels.recent', limit],
    queryFn: async () => {
      const res = await fetch(`/api/labels/recent?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to load recent label prints');
      const data = await res.json();
      return Array.isArray(data?.items) ? data.items : [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
