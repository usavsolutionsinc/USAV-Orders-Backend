'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { sectionLabel, cardTitle, fieldLabel } from '@/design-system/tokens/typography/presets';
import { ClipboardList, Package, FileText, Search, User } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { AuditLogFilterStrip } from '@/components/audit-log/AuditLogFilterStrip';

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

  const switchSection = (target: AuditSection) => {
    // Preserve shared filters (day/start/end/staffId) across section changes.
    const params = new URLSearchParams(searchParams.toString());
    for (const p of SECTION_OWNED_PARAMS) params.delete(p);
    const qs = params.toString();
    router.push(qs ? `${target.href}?${qs}` : target.href);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Section nav */}
      <div className="border-b border-gray-100 px-3 py-3">
        <p className={`px-1 ${sectionLabel} text-emerald-600`}>Audit Log</p>
        <p className={`mt-1 px-1 text-[11px] font-semibold leading-snug text-gray-500`}>
          Every event captured per page — who, when, what changed.
        </p>
        <div className="mt-3">
          <HorizontalButtonSlider
            items={AUDIT_SECTION_ITEMS}
            value={activeSection?.id ?? 'receiving'}
            onChange={(nextId) => {
              const target = AUDIT_SECTIONS.find((s) => s.id === nextId);
              if (target?.available) switchSection(target);
            }}
            variant="nav"
            aria-label="Audit log section"
          />
        </div>
      </div>

      {/* Shared filter strip (date + staff) */}
      <AuditLogFilterStrip />

      {/* Per-section picker */}
      <div className="flex-1 overflow-hidden">
        {activeSection?.id === 'receiving' ? (
          <ReceivingPOPicker
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
          <PackingTrackingPicker />
        ) : activeSection?.id === 'tech' ? (
          <TechSessionPicker />
        ) : activeSection?.id === 'sku' ? (
          <SkuPicker />
        ) : activeSection?.id === 'staff' ? (
          <div className="px-4 py-6 text-center text-[11px] text-gray-400">
            Pick a staff member above to load their cross-section audit feed.
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-gray-400">
            Select a section above.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Receiving PO picker (lives inside the sidebar) ────────────────────────

function ReceivingPOPicker({
  selectedPo,
  onSelect,
}: {
  selectedPo: string | null;
  onSelect: (po: string | null) => void;
}) {
  const [query, setQuery] = useState('');
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
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search PO, SKU, item…"
            className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-[11px] text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-gray-400">No POs found.</div>
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
                    className={`w-full px-3 py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={`truncate text-xs font-semibold ${fieldLabel} text-gray-900`}>
                        {po.po_number ?? po.po_id}
                      </div>
                      <div className="shrink-0 text-[10px] text-gray-400">
                        {relTime(po.latest_event_at)}
                      </div>
                    </div>
                    {po.vendor_name && (
                      <div className="truncate text-[11px] text-gray-500">{po.vendor_name}</div>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500">
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
  placeholder,
  rows,
  selectedKey,
  onSelect,
  loading,
  error,
  onSearch,
}: {
  placeholder: string;
  rows: ListRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  loading: boolean;
  error: string | null;
  onSearch: (q: string) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, onSearch]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-[11px] text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-gray-400">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => {
              const isSelected = row.key === selectedKey;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.key)}
                    className={`w-full px-3 py-2.5 text-left transition ${
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
                        <div className="shrink-0 text-[10px] text-gray-400">{row.trailing}</div>
                      )}
                    </div>
                    {row.subtitle && (
                      <div className="truncate text-[11px] text-gray-500">{row.subtitle}</div>
                    )}
                    {row.meta && (
                      <div className="mt-1 text-[10px] text-gray-500">{row.meta}</div>
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

function PackingTrackingPicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('tracking');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<PackingTrackingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/packing', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (search) url.searchParams.set('q', search);
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
  }, [sharedQS, search]);

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
      placeholder="Search tracking, SKU, packer…"
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tracking', key);
        router.replace(`/audit-log/packing?${params.toString()}`);
      }}
      loading={loading}
      error={error}
      onSearch={setSearch}
    />
  );
}

// ─── Tech session picker ───────────────────────────────────────────────────

interface TechSessionSummary {
  tracking: string;
  tester_id: number | null;
  tester_name: string | null;
  serial_count: number;
  latest_event_at: string | null;
  sku_summary: string | null;
}

function TechSessionPicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('session');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<TechSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/tech', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (search) url.searchParams.set('q', search);
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
  }, [sharedQS, search]);

  const listRows: ListRow[] = rows.map((r) => ({
    key: r.tracking,
    title: r.tracking,
    subtitle: r.sku_summary ?? '—',
    meta: `${r.serial_count} serial${r.serial_count === 1 ? '' : 's'}${
      r.tester_name ? ` · ${r.tester_name}` : ''
    }`,
    trailing: relTime(r.latest_event_at),
  }));

  return (
    <SidebarListPicker
      placeholder="Search tracking, serial, tester…"
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('session', key);
        router.replace(`/audit-log/tech?${params.toString()}`);
      }}
      loading={loading}
      error={error}
      onSearch={setSearch}
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

function SkuPicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('sku');
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<SkuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL('/api/audit-log/sku', window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (search) url.searchParams.set('q', search);
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
  }, [sharedQS, search]);

  const listRows: ListRow[] = rows.map((r) => ({
    key: r.sku,
    title: r.sku,
    subtitle: r.item_name ?? '—',
    meta: `${r.event_count} event${r.event_count === 1 ? '' : 's'}`,
    trailing: relTime(r.latest_event_at),
  }));

  return (
    <SidebarListPicker
      placeholder="Search SKU or item name…"
      rows={listRows}
      selectedKey={selected}
      onSelect={(key) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sku', key);
        router.replace(`/audit-log/sku?${params.toString()}`);
      }}
      loading={loading}
      error={error}
      onSearch={setSearch}
    />
  );
}
