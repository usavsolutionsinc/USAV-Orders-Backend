'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { sectionLabel, cardTitle, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';
import { ClipboardList, Package, FileText, Search, User } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { AuditLogFilterStrip, useAuditLogFilterRefinements, AuditLogFilterDropdown } from '@/components/audit-log/AuditLogFilterStrip';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SidebarShell } from '@/components/layout/SidebarShell';

// ─── Section nav ───────────────────────────────────────────────────────────

interface AuditSection {
  id: string;
  label: string;
  href: string;
  icon: (props: { className?: string }) => JSX.Element;
  available: boolean;
}

const AUDIT_SECTIONS: AuditSection[] = [
  { id: 'receiving', label: 'Receiving', href: '/audit-log/receiving', icon: ClipboardList, available: true },
  { id: 'packing',   label: 'Packing',   href: '/audit-log/packing',   icon: Package,       available: true  },
  { id: 'tech',      label: 'Tech',      href: '/audit-log/tech',      icon: FileText,      available: true  },
  { id: 'sku',       label: 'SKU',       href: '/audit-log/sku',       icon: Search,        available: true  },
  { id: 'staff',     label: 'Staff',     href: '/audit-log/staff',     icon: User,          available: true  },
];

// Params that are owned by individual section selections — stripped on
// section switch. The shared filter strip's params (day/start/end/staffId)
// persist across sections by design.
const SECTION_OWNED_PARAMS = ['po', 'tracking', 'session', 'sku'] as const;

const AUDIT_SECTION_ITEMS: HorizontalSliderItem[] = AUDIT_SECTIONS.map((s) => ({
  id: s.id,
  label: s.label,
  icon: s.icon,
  disabled: !s.available,
}));

// ─── PO list types ─────────────────────────────────────────────────────────

interface POSummary {
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  line_count: number;
  carton_count: number;
  quantity_expected: number;
  quantity_received: number;
  latest_event_at: string | null;
  last_actor_name: string | null;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

// ─── Panel ─────────────────────────────────────────────────────────────────

export function AuditLogSidebarPanel() {
  const pathname = usePathname() || '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = AUDIT_SECTIONS.find(
    (s) => s.available && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
  );

  const [searchQuery, setSearchQuery] = useState('');

  const { refinements, clearAll } = useAuditLogFilterRefinements();

  const switchSection = (target: AuditSection) => {
    // Preserve shared filters (day/start/end/staffId) across section changes.
    const params = new URLSearchParams(searchParams.toString());
    for (const p of SECTION_OWNED_PARAMS) params.delete(p);
    const qs = params.toString();
    router.push(qs ? `${target.href}?${qs}` : target.href);
  };

  return (
    <SidebarShell
      headerAbove={
        <div className={`${SIDEBAR_GUTTER} py-3 border-b border-gray-100`}>
          <p className={`px-1 ${sectionLabel} text-emerald-600`}>Audit Log</p>
          <p className={`mt-1 px-1 text-caption font-semibold leading-snug text-gray-500`}>
            Who, when, and what changed.
          </p>
        </div>
      }
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: `Search ${activeSection?.label || 'audit'}...`,
        variant: 'blue',
      }}
      filter={{
        label: 'Audit Filters',
        refinements,
        onClearAll: clearAll,
        renderDropdown: (onClose) => <AuditLogFilterDropdown onClose={onClose} />,
      }}
      headerRows={[
        <HorizontalButtonSlider
          key="sections"
          items={AUDIT_SECTION_ITEMS}
          value={activeSection?.id ?? 'receiving'}
          onChange={(nextId) => {
            const target = AUDIT_SECTIONS.find((s) => s.id === nextId);
            if (target?.available) switchSection(target);
          }}
          variant="nav"
          aria-label="Audit log section"
        />,
      ]}
      bodyClassName="pt-0 pb-6"
    >
      {activeSection?.id === 'receiving' ? (
        <ReceivingPOPicker
          query={searchQuery}
          selectedPo={searchParams.get('po')}
          onSelect={(po) => {
            const params = new URLSearchParams(searchParams.toString());
            if (po) params.set('po', po);
            else params.delete('po');
            router.replace(
              `/audit-log/receiving${params.toString() ? `?${params.toString()}` : ''}`,
            );
          }}
        />
      ) : activeSection?.id === 'packing' ? (
        <PackingTrackingPicker query={searchQuery} />
      ) : activeSection?.id === 'tech' ? (
        <TechSessionPicker query={searchQuery} />
      ) : activeSection?.id === 'sku' ? (
        <SkuPicker query={searchQuery} />
      ) : activeSection?.id === 'staff' ? (
        <div className="px-4 py-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-3">
            <User className="h-6 w-6" />
          </div>
          <p className="text-caption font-bold text-gray-900 mb-1">Staff Audit Feed</p>
          <p className="text-[11px] text-gray-500 max-w-[180px] mx-auto">
            Select a staff member in the filters above to load their cross-section audit feed.
          </p>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-gray-400">
          Select a section above.
        </div>
      )}
    </SidebarShell>
  );
}

// ─── Receiving PO picker (lives inside the sidebar) ────────────────────────

function ReceivingPOPicker({
  query,
  selectedPo,
  onSelect,
}: {
  query: string;
  selectedPo: string | null;
  onSelect: (po: string | null) => void;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pos, setPos] = useState<POSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/receiving', window.location.origin);
    if (debouncedQuery) url.searchParams.set('q', debouncedQuery);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setPos(d.items ?? []);
        else setError(d?.error ?? 'Failed to load POs');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const list = useMemo(() => pos, [pos]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-caption text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-center text-caption text-gray-400">No POs found.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {list.map((po) => {
              const isSelected = po.po_id === selectedPo;
              const pct =
                po.quantity_expected > 0
                  ? Math.min(100, Math.round((po.quantity_received / po.quantity_expected) * 100))
                  : 0;
              return (
                <li key={po.po_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(po.po_id)}
                    className={`w-full ${SIDEBAR_GUTTER} py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={`truncate text-xs font-semibold ${fieldLabel} text-gray-900`}>
                        {po.po_number ?? po.po_id}
                      </div>
                      <div className="shrink-0 text-micro text-gray-400">
                        {relTime(po.latest_event_at)}
                      </div>
                    </div>
                    {po.vendor_name && (
                      <div className="truncate text-caption text-gray-500">{po.vendor_name}</div>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-micro text-gray-500">
                      <span>{po.line_count}L</span>
                      <span>·</span>
                      <span>{po.carton_count}C</span>
                      <span>·</span>
                      <span className="font-semibold text-gray-700">
                        {po.quantity_received}/{po.quantity_expected}
                      </span>
                      {po.last_actor_name && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <User className="h-3 w-3" />
                            <span className="truncate max-w-[70px]">{po.last_actor_name}</span>
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Shared list-picker shell ──────────────────────────────────────────────

interface ListRow {
  key: string;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: string;
}

function SidebarListPicker({
  rows,
  selectedKey,
  onSelect,
  loading,
  error,
}: {
  rows: ListRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-caption text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-center text-caption text-gray-400">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => {
              const isSelected = row.key === selectedKey;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.key)}
                    className={`w-full ${SIDEBAR_GUTTER} py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={`truncate text-xs font-semibold ${fieldLabel} text-gray-900`}>
                        {row.title}
                      </div>
                      {row.trailing && (
                        <div className="shrink-0 text-micro text-gray-400">{row.trailing}</div>
                      )}
                    </div>
                    {row.subtitle && (
                      <div className="truncate text-caption text-gray-500">{row.subtitle}</div>
                    )}
                    {row.meta && (
                      <div className="mt-1 text-micro text-gray-500">{row.meta}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function useSharedFilterQS(): string {
  const sp = useSearchParams();
  return useMemo(() => {
    const next = new URLSearchParams();
    for (const k of ['day', 'start', 'end', 'staffId']) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    return next.toString();
  }, [sp]);
}

// ─── Packing tracking picker ───────────────────────────────────────────────

interface PackingTrackingSummary {
  tracking: string;
  packer_log_id: number;
  pack_date_time: string | null;
  packed_by_name: string | null;
  sku_summary: string | null;
  event_count: number;
}

function PackingTrackingPicker({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('tracking');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<PackingTrackingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/packing', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setRows(d.items ?? []);
        else setError(d?.error ?? 'Failed to load packing logs');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sharedQS, query]);

  const listRows: ListRow[] = rows.map((r) => ({
    key: r.tracking,
    title: r.tracking,
    subtitle: r.sku_summary ?? '—',
    meta: `${r.event_count} event${r.event_count === 1 ? '' : 's'}${
      r.packed_by_name ? ` · ${r.packed_by_name}` : ''
    }`,
    trailing: relTime(r.pack_date_time),
  }));

  return (
    <SidebarListPicker
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tracking', key);
        router.replace(`/audit-log/packing?${params.toString()}`);
      }}
      loading={loading}
      error={error}
    />
  );
}

// ─── Tech session picker ───────────────────────────────────────────────────

interface TechSessionSummary {
  session_key: string;
  tracking: string;
  tester_id: number | null;
  tester_name: string | null;
  serial_count: number;
  latest_event_at: string | null;
  sku_summary: string | null;
}

function TechSessionPicker({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('session');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<TechSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/tech', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setRows(d.items ?? []);
        else setError(d?.error ?? 'Failed to load tech sessions');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sharedQS, query]);

  const listRows: ListRow[] = rows.map((r) => ({
    key: r.session_key || r.tracking,
    title: r.tracking,
    subtitle: r.sku_summary ?? '—',
    meta: `${r.serial_count} serial${r.serial_count === 1 ? '' : 's'}${
      r.tester_name ? ` · ${r.tester_name}` : ''
    }`,
    trailing: relTime(r.latest_event_at),
  }));

  return (
    <SidebarListPicker
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('session', key);
        router.replace(`/audit-log/tech?${params.toString()}`);
      }}
      loading={loading}
      error={error}
    />
  );
}

// ─── SKU picker ────────────────────────────────────────────────────────────

interface SkuSummary {
  sku: string;
  item_name: string | null;
  event_count: number;
  latest_event_at: string | null;
}

function SkuPicker({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('sku');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<SkuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/sku', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setRows(d.items ?? []);
        else setError(d?.error ?? 'Failed to load SKUs');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sharedQS, query]);

  const listRows: ListRow[] = rows.map((r) => ({
    key: r.sku,
    title: r.sku,
    subtitle: r.item_name ?? '—',
    meta: `${r.event_count} event${r.event_count === 1 ? '' : 's'}`,
    trailing: relTime(r.latest_event_at),
  }));

  return (
    <SidebarListPicker
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sku', key);
        router.replace(`/audit-log/sku?${params.toString()}`);
      }}
      loading={loading}
      error={error}
    />
  );
}
