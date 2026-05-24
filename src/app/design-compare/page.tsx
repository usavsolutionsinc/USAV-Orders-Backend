'use client';

/**
 * Side-by-side design comparison: current /tech order list + preview panel
 * vs. a Linear-style proposed approach.
 *
 * Self-contained on purpose — uses hardcoded mock orders so this page can
 * be reviewed without auth, data, or the live workspace. Visit /design-compare.
 */

import { useState } from 'react';

type MockOrder = {
  id: string;
  shortId: string;
  shipBy: string;
  daysLate: number;
  daysLatePhrase: string;
  quantity: number;
  condition: 'New' | 'Used' | 'Refurb';
  title: string;
  sku: string;
  itemNumber: string;
  tracking: string;
  channel: string;
  customer: string;
  total: string;
  outOfStock?: string;
  assignee?: string;
};

const ORDERS: MockOrder[] = [
  {
    id: 'ord_a8821',
    shortId: '8821',
    shipBy: 'May 19',
    daysLate: 4,
    daysLatePhrase: '4 days late',
    quantity: 1,
    condition: 'New',
    title: 'Cisco Catalyst 9200L-24P-4G-E 24-Port PoE+ Network Switch',
    sku: 'WS-C9200L-24P-4G',
    itemNumber: '186742091123',
    tracking: '1Z999AA10123456784',
    channel: 'eBay',
    customer: 'Mariana Ortiz',
    total: '$1,284.00',
    assignee: 'Jordan',
  },
  {
    id: 'ord_a8822',
    shortId: '8822',
    shipBy: 'May 22',
    daysLate: 1,
    daysLatePhrase: 'Due today',
    quantity: 2,
    condition: 'Refurb',
    title: 'HP ProLiant DL360 Gen10 1U Rack Server 2x Xeon Gold 6248',
    sku: 'HP-DL360-G10-6248',
    itemNumber: '186742091987',
    tracking: '',
    channel: 'Shopify',
    customer: 'Logistics Direct LLC',
    total: '$3,950.00',
    outOfStock: 'Caddy missing for bay 3 — need spare from shelf B-12',
  },
  {
    id: 'ord_a8823',
    shortId: '8823',
    shipBy: 'May 24',
    daysLate: -1,
    daysLatePhrase: 'Due tomorrow',
    quantity: 1,
    condition: 'Used',
    title: 'Dell PowerEdge R740 2x Xeon Silver 4214 32GB RAM',
    sku: 'DELL-R740-4214',
    itemNumber: '186742092004',
    tracking: '1Z999AA10123456999',
    channel: 'Amazon',
    customer: 'Northbridge Networks',
    total: '$2,140.00',
    assignee: 'Marcus',
  },
  {
    id: 'ord_a8824',
    shortId: '8824',
    shipBy: 'May 26',
    daysLate: -3,
    daysLatePhrase: '3 days ahead',
    quantity: 4,
    condition: 'New',
    title: 'Aruba 2930F 48G PoE+ 4SFP+ Switch',
    sku: 'ARUBA-2930F-48',
    itemNumber: '186742092115',
    tracking: '',
    channel: 'eBay',
    customer: 'WiredCorp',
    total: '$5,800.00',
  },
];

export default function DesignComparePage() {
  return (
    <div className="min-h-screen bg-gray-100 px-6 py-6">
      <header className="mx-auto mb-5 max-w-[1440px]">
        <h1 className="text-xl font-black tracking-tight text-gray-900">
          Order list → detail panel · design comparison
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Left: current /tech behavior · Right: Linear-style proposal (opacity-only hover actions,
          left accent bar selection, sticky header + summary strip + tabs)
        </p>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-4">
        <PanelFrame label="Current" tone="muted">
          <CurrentDesign />
        </PanelFrame>
        <PanelFrame label="Proposed · Linear-style" tone="accent">
          <ProposedDesign />
        </PanelFrame>
      </div>

      <NotesBlock />
    </div>
  );
}

/* ── Frame ─────────────────────────────────────────────────────────────── */

function PanelFrame({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'muted' | 'accent';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        tone === 'accent' ? 'border-emerald-300' : 'border-gray-200'
      }`}
    >
      <div
        className={`flex items-center justify-between border-b px-4 py-2.5 ${
          tone === 'accent'
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        <span
          className={`text-micro font-black uppercase tracking-widest ${
            tone === 'accent' ? 'text-emerald-700' : 'text-gray-500'
          }`}
        >
          {label}
        </span>
      </div>
      <div className="h-[720px] bg-white">{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  CURRENT DESIGN (mirrors /tech today)
 *  ───────────────────────────────────────────────────────────────────────── */

function CurrentDesign() {
  const [selectedId, setSelectedId] = useState<string>('ord_a8822');
  const selected = ORDERS.find((o) => o.id === selectedId) || ORDERS[0];

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div className="overflow-y-auto border-r border-gray-200 px-3 py-3">
        <SectionLabel>Up Next · 4</SectionLabel>
        {ORDERS.map((o) => (
          <CurrentCard
            key={o.id}
            order={o}
            isSelected={o.id === selectedId}
            onClick={() =>
              setSelectedId((cur) => (cur === o.id ? '' : o.id))
            }
          />
        ))}
      </div>
      <div className="overflow-y-auto px-5 py-5">
        {selected ? <CurrentPreview order={selected} /> : <EmptyPreview />}
      </div>
    </div>
  );
}

function CurrentCard({
  order,
  isSelected,
  onClick,
}: {
  order: MockOrder;
  isSelected: boolean;
  onClick: () => void;
}) {
  const lateTone =
    order.daysLate > 1
      ? 'text-red-600'
      : order.daysLate === 1
      ? 'text-orange-600'
      : order.daysLate === 0
      ? 'text-amber-600'
      : 'text-emerald-600';

  return (
    <div
      onClick={onClick}
      className={`group relative mb-1 cursor-pointer rounded-xl px-3 py-3 transition-all ${
        isSelected
          ? 'bg-emerald-50/70 ring-2 ring-inset ring-emerald-300 shadow-[0_1px_2px_rgba(16,185,129,0.10),0_4px_12px_-4px_rgba(16,185,129,0.15)]'
          : 'border-b-2 border-emerald-200 bg-white hover:border-emerald-500'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-tight text-gray-900">
            {order.shipBy}
          </span>
          <span className={`text-label font-black tracking-tight ${lateTone}`}>
            {order.daysLate > 0 ? `+${order.daysLate}` : order.daysLate}
          </span>
        </div>
        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-caption font-bold text-gray-700">
          #{order.shortId}
        </span>
      </div>
      <h4 className="text-base font-semibold leading-snug tracking-tight text-gray-900">
        <span className="mr-1 rounded bg-amber-100 px-1 font-mono text-caption text-amber-700">
          x{order.quantity}
        </span>{' '}
        <span className={conditionColor(order.condition)}>{order.condition}</span>{' '}
        {order.title}
      </h4>
      {order.outOfStock && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/60 px-2.5 py-1.5">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-red-700">
            {order.outOfStock}
          </span>
        </div>
      )}

      {/* The PROBLEMATIC hover bottom bar — shifts neighbors */}
      <div className="mt-2 hidden h-7 items-center justify-between rounded-md bg-gray-50 px-2 group-hover:flex">
        <span className="text-micro font-bold uppercase tracking-widest text-gray-500">
          Quick actions
        </span>
        <div className="flex items-center gap-1">
          <button className="rounded bg-white px-2 py-0.5 text-micro font-semibold text-gray-700 ring-1 ring-gray-200">
            Start
          </button>
          <button className="rounded bg-white px-2 py-0.5 text-micro font-semibold text-gray-700 ring-1 ring-gray-200">
            OOS
          </button>
        </div>
      </div>
    </div>
  );
}

function CurrentPreview({ order }: { order: MockOrder }) {
  const lateTone =
    order.daysLate > 1
      ? 'text-red-600'
      : order.daysLate === 1
      ? 'text-orange-600'
      : 'text-emerald-600';

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-black tracking-tight text-gray-900">
            {order.shipBy}
          </span>
          <span className="text-gray-300">·</span>
          <span className={`text-sm font-black tracking-tight ${lateTone}`}>
            {order.daysLatePhrase}
          </span>
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline gap-2 text-label font-bold">
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-caption text-amber-700">
              x{order.quantity}
            </span>
            <span className={`${conditionColor(order.condition)} font-black tracking-tight`}>
              {order.condition}
            </span>
          </div>
          <h2 className="text-xl font-bold leading-tight tracking-tight text-gray-900">
            {order.title}
          </h2>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-caption font-bold text-gray-700">
            {order.channel}
          </span>
          <span className="text-caption font-semibold text-gray-500">
            {order.channel} listing
          </span>
          {order.assignee && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-caption font-semibold text-gray-500">
                Assigned to <span className="text-gray-800">{order.assignee}</span>
              </span>
            </>
          )}
        </div>
      </div>

      {order.outOfStock && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-black uppercase tracking-widest text-red-600">
              Out of stock
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-red-800">
              {order.outOfStock}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <MetaCellCurrent label="SKU" value={order.sku.slice(-6)} mono />
        <MetaCellCurrent label="Item #" value={order.itemNumber.slice(-4)} />
        <MetaCellCurrent
          label="Tracking"
          value={order.tracking ? order.tracking.slice(-4) : 'N/A'}
          mono
        />
      </div>
    </div>
  );
}

function MetaCellCurrent({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="mb-1 text-micro font-black uppercase tracking-widest text-gray-400">
        {label}
      </div>
      <div
        className={`truncate text-sm font-bold text-gray-900 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  PROPOSED DESIGN — Linear-style
 *  ───────────────────────────────────────────────────────────────────────── */

function ProposedDesign() {
  const [selectedId, setSelectedId] = useState<string>('ord_a8822');
  const [tab, setTab] = useState<'items' | 'activity' | 'shipping' | 'notes'>('items');
  const idx = ORDERS.findIndex((o) => o.id === selectedId);
  const selected = ORDERS[idx] || ORDERS[0];

  const goPrev = () => setSelectedId(ORDERS[Math.max(0, idx - 1)].id);
  const goNext = () => setSelectedId(ORDERS[Math.min(ORDERS.length - 1, idx + 1)].id);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      {/* LEFT — clean row list */}
      <div className="flex h-full flex-col overflow-hidden border-r border-gray-200 bg-gray-50/40">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-micro font-black uppercase tracking-widest text-gray-500">
            Up Next · {ORDERS.length}
          </span>
          <button className="rounded-md bg-white px-2 py-0.5 text-micro font-bold text-gray-600 ring-1 ring-gray-200 hover:ring-gray-300">
            Filter
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {ORDERS.map((o) => (
            <ProposedRow
              key={o.id}
              order={o}
              isSelected={o.id === selectedId}
              onClick={() => setSelectedId(o.id)}
            />
          ))}
        </div>
      </div>

      {/* RIGHT — sticky header, summary strip, tabs, sticky footer */}
      <div className="flex h-full flex-col bg-white">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-5 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-caption font-semibold text-gray-500">
                <span className="font-mono text-gray-700">#{selected.shortId}</span>
                <span className="text-gray-300">·</span>
                <span>{selected.channel}</span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-700">{selected.customer}</span>
              </div>
              <h2 className="truncate text-lg font-bold leading-tight tracking-tight text-gray-900">
                {selected.title}
              </h2>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                onClick={goPrev}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"
                aria-label="Previous order"
              >
                ↑
              </button>
              <button
                onClick={goNext}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"
                aria-label="Next order"
              >
                ↓
              </button>
              <div className="mx-1 h-5 w-px bg-gray-200" />
              <button className="rounded-md bg-emerald-600 px-3 py-1 text-label font-bold text-white shadow-sm hover:bg-emerald-700">
                Start
              </button>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"
                aria-label="More actions"
              >
                ⋯
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div className="mt-3 grid grid-cols-5 gap-2">
            <SummaryTile
              label="Status"
              value={
                <StatusPill
                  tone={selected.outOfStock ? 'red' : selected.daysLate > 1 ? 'orange' : 'emerald'}
                >
                  {selected.outOfStock
                    ? 'Out of stock'
                    : selected.daysLate > 1
                    ? 'Late'
                    : 'On track'}
                </StatusPill>
              }
            />
            <SummaryTile label="Ship by" value={selected.shipBy} />
            <SummaryTile
              label="Urgency"
              value={
                <span
                  className={`text-sm font-bold ${
                    selected.daysLate > 1
                      ? 'text-red-600'
                      : selected.daysLate === 1
                      ? 'text-orange-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {selected.daysLatePhrase}
                </span>
              }
            />
            <SummaryTile label="Qty" value={`×${selected.quantity}`} mono />
            <SummaryTile label="Total" value={selected.total} mono />
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 bg-white px-5">
          <nav className="-mb-px flex gap-5">
            {(['items', 'activity', 'shipping', 'notes'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b-2 px-0.5 py-2 text-label font-bold capitalize tracking-tight transition-colors ${
                  tab === t
                    ? 'border-emerald-600 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'items' && <ProposedItemsTab order={selected} />}
          {tab === 'activity' && <ProposedActivityTab order={selected} />}
          {tab === 'shipping' && <ProposedShippingTab order={selected} />}
          {tab === 'notes' && <ProposedNotesTab order={selected} />}
        </div>

        {/* Sticky footer — destructive zone */}
        <div className="border-t border-gray-200 bg-gray-50/60 px-5 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-caption font-semibold text-gray-500">
              {selected.assignee
                ? `Assigned to ${selected.assignee}`
                : 'Unassigned'}
            </span>
            <div className="flex items-center gap-2">
              <button className="text-caption font-semibold text-gray-500 hover:text-gray-900">
                Reassign
              </button>
              <span className="text-gray-300">·</span>
              <button className="text-caption font-semibold text-red-600 hover:text-red-700">
                Cancel order
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposedRow({
  order,
  isSelected,
  onClick,
}: {
  order: MockOrder;
  isSelected: boolean;
  onClick: () => void;
}) {
  const lateTone =
    order.daysLate > 1
      ? 'text-red-600'
      : order.daysLate === 1
      ? 'text-orange-600'
      : order.daysLate === 0
      ? 'text-amber-600'
      : 'text-emerald-600';

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer overflow-hidden rounded-lg px-3 py-2.5 transition-colors ${
        isSelected
          ? 'bg-white ring-1 ring-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
          : 'hover:bg-white'
      }`}
    >
      {/* Left accent bar — selected only, reserved width so no shift */}
      <span
        className={`absolute inset-y-1.5 left-0 w-[3px] rounded-r-full transition-opacity ${
          isSelected ? 'bg-emerald-500 opacity-100' : 'bg-emerald-500 opacity-0'
        }`}
      />

      <div className="flex items-start gap-2 pl-2">
        <div className="min-w-0 flex-1">
          {/* Primary line */}
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="font-mono text-caption font-bold text-gray-500">
              #{order.shortId}
            </span>
            <span className="text-gray-300">·</span>
            <span className="truncate text-label font-semibold text-gray-900">
              {order.customer}
            </span>
          </div>
          {/* Secondary line — title */}
          <h4 className="line-clamp-1 text-sm font-semibold leading-snug text-gray-800">
            <span className={`${conditionColor(order.condition)} font-bold`}>
              {order.condition}
            </span>{' '}
            {order.title}
          </h4>
          {/* Tertiary line — pills */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <StatusPill
              tone={
                order.outOfStock
                  ? 'red'
                  : order.daysLate > 1
                  ? 'orange'
                  : order.daysLate >= 0
                  ? 'amber'
                  : 'emerald'
              }
              size="xs"
            >
              {order.outOfStock ? 'OOS' : order.shipBy}
            </StatusPill>
            <span className={`text-caption font-bold tracking-tight ${lateTone}`}>
              {order.daysLatePhrase}
            </span>
            <span className="ml-auto rounded bg-amber-100 px-1.5 font-mono text-micro font-bold text-amber-700">
              ×{order.quantity}
            </span>
          </div>
        </div>

        {/* Trailing action slot — reserved width so layout never shifts */}
        <div className="flex-shrink-0">
          <button
            onClick={(e) => e.stopPropagation()}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-opacity hover:bg-gray-100 hover:text-gray-700 ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            aria-label="Row actions"
          >
            ⋯
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposedItemsTab({ order }: { order: MockOrder }) {
  return (
    <div className="space-y-3">
      {order.outOfStock && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5">
          <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-black uppercase tracking-widest text-red-600">
              Out of stock
            </p>
            <p className="mt-0.5 text-label font-semibold leading-snug text-red-800">
              {order.outOfStock}
            </p>
          </div>
        </div>
      )}

      <div>
        <SectionHeading>Line items</SectionHeading>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-label">
            <thead className="bg-gray-50 text-micro font-black uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100">
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-gray-900">{order.title}</div>
                  <div className="mt-0.5 font-mono text-caption text-gray-500">
                    SKU {order.sku}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-gray-900">
                  ×{order.quantity}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-gray-900">
                  {order.total}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <SectionHeading>Identifiers</SectionHeading>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-gray-50/40 px-4 py-3">
          <KvRow label="SKU" value={order.sku} mono />
          <KvRow label="Item #" value={order.itemNumber} mono />
          <KvRow
            label="Tracking"
            value={order.tracking || '—'}
            mono
            muted={!order.tracking}
          />
          <KvRow label="Channel" value={order.channel} />
        </dl>
      </div>
    </div>
  );
}

function ProposedActivityTab({ order }: { order: MockOrder }) {
  const events = [
    { t: '2 min ago', who: 'System', what: `Order ${order.shortId} entered Up Next queue` },
    { t: '11 min ago', who: order.assignee || 'System', what: 'Assigned to technician' },
    { t: '34 min ago', who: 'System', what: 'Payment captured' },
    { t: '1 hr ago', who: 'System', what: `Order placed via ${order.channel}` },
  ];
  return (
    <div>
      <SectionHeading>Recent activity</SectionHeading>
      <ol className="relative space-y-3 border-l border-gray-200 pl-4">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
            <div className="text-label font-semibold text-gray-900">{e.what}</div>
            <div className="text-caption text-gray-500">
              {e.who} · {e.t}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProposedShippingTab({ order }: { order: MockOrder }) {
  return (
    <div>
      <SectionHeading>Shipping</SectionHeading>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-gray-50/40 px-4 py-3">
        <KvRow label="Ship by" value={order.shipBy} />
        <KvRow label="Customer" value={order.customer} />
        <KvRow
          label="Tracking"
          value={order.tracking || 'Not yet shipped'}
          mono={!!order.tracking}
          muted={!order.tracking}
        />
        <KvRow label="Carrier" value={order.tracking ? 'UPS Ground' : '—'} />
      </dl>
    </div>
  );
}

function ProposedNotesTab({ order }: { order: MockOrder }) {
  return (
    <div>
      <SectionHeading>Notes</SectionHeading>
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/40 px-4 py-6 text-center">
        <p className="text-label font-semibold text-gray-500">
          No notes on order #{order.shortId}
        </p>
        <button className="mt-2 rounded-md bg-white px-3 py-1 text-caption font-bold text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300">
          Add note
        </button>
      </div>
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 px-1 text-micro font-black uppercase tracking-widest text-gray-500">
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-micro font-black uppercase tracking-widest text-gray-500">
      {children}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-2">
      <div
        className={`text-sm font-bold text-gray-900 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-500">
        {label}
      </div>
    </div>
  );
}

function StatusPill({
  children,
  tone,
  size = 'sm',
}: {
  children: React.ReactNode;
  tone: 'emerald' | 'orange' | 'red' | 'amber' | 'gray';
  size?: 'xs' | 'sm';
}) {
  const tones: Record<typeof tone, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-gray-100 text-gray-700',
  };
  const sizes = {
    xs: 'text-micro px-1.5 py-0.5',
    sm: 'text-caption px-2 py-0.5',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md font-bold ${tones[tone]} ${sizes[size]}`}
    >
      {children}
    </span>
  );
}

function KvRow({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <>
      <dt className="text-micro font-black uppercase tracking-widest text-gray-500">
        {label}
      </dt>
      <dd
        className={`truncate text-label font-semibold ${
          muted ? 'text-gray-400' : 'text-gray-900'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}

function EmptyPreview() {
  return (
    <div className="flex h-full items-center justify-center text-label font-semibold text-gray-400">
      Select an order to preview
    </div>
  );
}

function conditionColor(c: MockOrder['condition']) {
  switch (c) {
    case 'New':
      return 'text-emerald-600';
    case 'Refurb':
      return 'text-purple-600';
    case 'Used':
      return 'text-blue-600';
  }
}

/* ── Notes ─────────────────────────────────────────────────────────────── */

function NotesBlock() {
  return (
    <div className="mx-auto mt-5 max-w-[1440px] rounded-2xl border border-gray-200 bg-white p-5 text-label text-gray-700">
      <h3 className="mb-2 text-sm font-black tracking-tight text-gray-900">
        What changed (hover a card on each side to compare)
      </h3>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-label">
        <li>
          <strong>Current:</strong> Hover reveals a quick-actions bar at the bottom of
          each card → pushes neighbors down (layout shift).
        </li>
        <li>
          <strong>Proposed:</strong> Trailing <code>⋯</code> button with reserved width;
          fades in via opacity. Zero layout shift.
        </li>
        <li>
          <strong>Current:</strong> Selection = full perimeter ring + heavy shadow.
          Cards feel like "lifted tiles," row rhythm breaks.
        </li>
        <li>
          <strong>Proposed:</strong> Selection = left 3px accent bar + subtle bg. Row
          rhythm stays intact; one card is unmistakably "the one."
        </li>
        <li>
          <strong>Current:</strong> Right panel is a flat stack — urgency, title,
          callout, three meta cells. No persistent header or actions.
        </li>
        <li>
          <strong>Proposed:</strong> Sticky header (id · customer · title · prev/next
          · primary CTA · ⋯), 5-tile summary strip, tabbed body, sticky footer for
          destructive actions.
        </li>
        <li>
          <strong>Current:</strong> Card content order: ship date → quantity → title.
          Customer + total live nowhere on the card.
        </li>
        <li>
          <strong>Proposed:</strong> Row reads top-down: id · customer · title · qty /
          urgency / ship-by pill. Scannable as a sentence.
        </li>
        <li>
          <strong>Current:</strong> Primary action (Start) lives in a separate
          workspace dock, not where attention lands.
        </li>
        <li>
          <strong>Proposed:</strong> Primary CTA sits in the sticky header next to
          prev/next. Always reachable, never scrolls off.
        </li>
      </ul>
    </div>
  );
}
