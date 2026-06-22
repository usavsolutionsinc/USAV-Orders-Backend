'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SidebarListPicker } from './SidebarListPicker';
import { useAuditSectionList } from './useAuditSectionList';
import {
  relTime,
  type ListRow,
  type PackingTrackingSummary,
  type SkuSummary,
  type TechSessionSummary,
} from './audit-log-panel-shared';

/**
 * Generic audit section list-picker. Packing / Tech / SKU are identical bar the
 * endpoint, error copy, URL param key, base path, and row mapping — so they all
 * flow through here. Selecting a row writes `?<paramKey>=<key>` and replaces.
 */
function AuditSectionPicker<T>({
  endpoint,
  errorMsg,
  paramKey,
  basePath,
  query,
  mapRow,
}: {
  endpoint: string;
  errorMsg: string;
  paramKey: string;
  basePath: string;
  query: string;
  mapRow: (row: T) => ListRow;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get(paramKey);
  const { rows, loading, error } = useAuditSectionList<T>(endpoint, query, errorMsg);

  return (
    <SidebarListPicker
      rows={rows.map(mapRow)}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramKey, key);
        router.replace(`${basePath}?${params.toString()}`);
      }}
      loading={loading}
      error={error}
    />
  );
}

export function PackingTrackingPicker({ query }: { query: string }) {
  return (
    <AuditSectionPicker<PackingTrackingSummary>
      endpoint="/api/audit-log/packing"
      errorMsg="Failed to load packing logs"
      paramKey="tracking"
      basePath="/audit-log/packing"
      query={query}
      mapRow={(r) => ({
        key: r.tracking,
        title: r.tracking,
        subtitle: r.sku_summary ?? '—',
        meta: `${r.event_count} event${r.event_count === 1 ? '' : 's'}${
          r.packed_by_name ? ` · ${r.packed_by_name}` : ''
        }`,
        trailing: relTime(r.pack_date_time),
      })}
    />
  );
}

export function TechSessionPicker({ query }: { query: string }) {
  return (
    <AuditSectionPicker<TechSessionSummary>
      endpoint="/api/audit-log/tech"
      errorMsg="Failed to load tech sessions"
      paramKey="session"
      basePath="/audit-log/tech"
      query={query}
      mapRow={(r) => ({
        key: r.session_key || r.tracking,
        title: r.tracking,
        subtitle: r.sku_summary ?? '—',
        meta: `${r.serial_count} serial${r.serial_count === 1 ? '' : 's'}${
          r.tester_name ? ` · ${r.tester_name}` : ''
        }`,
        trailing: relTime(r.latest_event_at),
      })}
    />
  );
}

export function SkuPicker({ query }: { query: string }) {
  return (
    <AuditSectionPicker<SkuSummary>
      endpoint="/api/audit-log/sku"
      errorMsg="Failed to load SKUs"
      paramKey="sku"
      basePath="/audit-log/sku"
      query={query}
      mapRow={(r) => ({
        key: r.sku,
        title: r.sku,
        subtitle: r.item_name ?? '—',
        meta: `${r.event_count} event${r.event_count === 1 ? '' : 's'}`,
        trailing: relTime(r.latest_event_at),
      })}
    />
  );
}
