'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Check,
  ChevronRight,
  Copy,
  Edit,
  ExternalLink,
  Flag,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Trash2,
} from '@/components/Icons';
import type { FbaSummaryRow } from '@/components/fba/types';
import { mainStickyHeaderClass } from '@/components/layout/header-shell';

interface FbaShipmentBoardProps {
  statusFilter: 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  refreshTrigger: number;
  searchQuery: string;
}

const ROW_MOTION = {
  rest: { backgroundColor: 'rgba(255,255,255,1)', x: 0, scale: 1 },
  hover: { backgroundColor: 'rgba(250,250,250,1)', x: 2, scale: 0.998 },
  active: { backgroundColor: 'rgba(245,245,245,1)', x: 4, scale: 0.995 },
};

function formatStatus(status: string | null) {
  return status ? status.replaceAll('_', ' ').toLowerCase() : 'unassigned';
}

function getAttentionQty(row: FbaSummaryRow) {
  const baseline = Math.max(row.expected_qty ?? 0, row.actual_qty ?? 0, row.tech_scanned_qty ?? 0);
  return Math.max(baseline - row.pack_ready_qty, 0);
}

function matchesStatus(row: FbaSummaryRow, statusFilter: FbaShipmentBoardProps['statusFilter']) {
  if (statusFilter === 'ALL') return true;
  return (row.shipment_item_status || 'PLANNED').toUpperCase() === statusFilter;
}

function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200">
        <Package className="h-6 w-6 text-gray-300" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-900">
          {searchQuery ? 'No FBA items match this search' : 'No FBA activity yet'}
        </p>
        <p className="text-xs text-gray-500">
          {searchQuery ? 'Try another FNSKU, ASIN, or product title.' : 'Items appear here once they enter the FBA workflow.'}
        </p>
      </div>
    </div>
  );
}

function FbaStatusIndicators({ ready, attention }: { ready: number; attention: number }) {
  return (
    <div className="flex items-end justify-end gap-4 text-[11px] font-medium text-gray-500">
      <div className="flex items-center gap-1.5" title="Ready to go quantity" aria-label={`Ready to go quantity ${ready}`}>
        <Check className="h-3.5 w-3.5 text-gray-900" />
        <span className="tabular-nums text-gray-900">{ready}</span>
      </div>
      <div className="flex items-center gap-1.5" title="Needs attention quantity" aria-label={`Needs attention quantity ${attention}`}>
        <AlertTriangle className="h-3.5 w-3.5 text-gray-400" />
        <span className="tabular-nums">{attention}</span>
      </div>
    </div>
  );
}

function InlineActionButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function InlineRowDetails({
  row,
  onRefresh,
  onOpenLabels,
}: {
  row: FbaSummaryRow;
  onRefresh: () => void;
  onOpenLabels: () => void;
}) {
  const attentionQty = getAttentionQty(row);
  const metadata = [
    { label: 'FNSKU', value: row.fnsku },
    { label: 'ASIN', value: row.asin || 'Not set' },
    { label: 'SKU', value: row.sku || 'Not set' },
    { label: 'Shipment', value: row.shipment_ref || 'Unassigned' },
    { label: 'Expected', value: String(row.expected_qty ?? 0) },
    { label: 'Shipped', value: String(row.shipped_qty) },
  ];

  const copyFnsku = async () => {
    try {
      await navigator.clipboard.writeText(row.fnsku);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="border-b border-gray-200 bg-gray-50/60 px-4 py-4 sm:px-6"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-2 xl:grid-cols-3">
            {metadata.map((entry) => (
              <div key={entry.label} className="bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">{entry.label}</p>
                <p className="mt-1 break-words text-sm text-gray-900">{entry.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-px border border-gray-200 bg-gray-200">
            <div className="grid gap-px sm:grid-cols-2">
              <div className="bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-gray-900">
                  <Check className="h-4 w-4" />
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Ready</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-950">{row.pack_ready_qty}</p>
              </div>
              <div className="bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-gray-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Attention</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-950">{attentionQty}</p>
              </div>
            </div>
            <div className="bg-white px-4 py-4 text-sm leading-6 text-gray-600">
              {attentionQty > 0
                ? `${attentionQty} unit${attentionQty === 1 ? '' : 's'} still need pack-ready work before the next shipment step.`
                : row.available_to_ship > 0
                  ? `${row.available_to_ship} unit${row.available_to_ship === 1 ? '' : 's'} are available to ship now.`
                  : 'No shipment blockers detected on this item.'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <InlineActionButton icon={<Copy className="h-4 w-4" />} label="Copy FNSKU" onClick={copyFnsku} />
          <InlineActionButton icon={<ExternalLink className="h-4 w-4" />} label="Open label queue" onClick={onOpenLabels} />
          <InlineActionButton icon={<RefreshCw className="h-4 w-4" />} label="Refresh item data" onClick={onRefresh} />
          <InlineActionButton icon={<Edit className="h-4 w-4" />} label="Edit workflow details" disabled />
          <InlineActionButton icon={<Flag className="h-4 w-4" />} label="Split shipment workflow" disabled />
          <InlineActionButton icon={<Trash2 className="h-4 w-4" />} label="Archive item" disabled />
        </div>
      </div>
    </motion.div>
  );
}

function FbaTableRow({
  row,
  isSelected,
  onSelect,
  onRefresh,
  onOpenLabels,
}: {
  row: FbaSummaryRow;
  isSelected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
  onOpenLabels: () => void;
}) {
  const attentionQty = getAttentionQty(row);
  const LeadingIcon = attentionQty > 0 ? AlertTriangle : PackageCheck;

  return (
    <>
      <motion.button
        type="button"
        onClick={onSelect}
        initial={false}
        animate={isSelected ? 'active' : 'rest'}
        whileHover="hover"
        variants={ROW_MOTION}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-3 border-b border-gray-200 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/15 sm:px-6"
        aria-pressed={isSelected}
      >
        <div className="flex min-w-0 items-start gap-3 self-end">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-gray-200">
            <LeadingIcon className={`h-4 w-4 ${attentionQty > 0 ? 'text-gray-500' : 'text-gray-900'}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-gray-950">{row.product_title || 'Untitled FBA item'}</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-[11px] font-medium tracking-[0.08em] text-gray-500">{row.fnsku}</span>
              {row.shipment_ref ? <span className="text-[11px] font-medium text-gray-400">{row.shipment_ref}</span> : null}
            </div>
          </div>
        </div>

        <FbaStatusIndicators ready={row.pack_ready_qty} attention={attentionQty} />

        <div className="flex items-center justify-end gap-2 self-end">
          <span className="hidden text-[11px] capitalize text-gray-400 xl:inline">{formatStatus(row.shipment_item_status)}</span>
          <ChevronRight className={`h-4 w-4 transition-all ${isSelected ? 'rotate-90 text-gray-900' : 'text-gray-300'}`} />
        </div>
      </motion.button>

      <AnimatePresence initial={false}>
        {isSelected ? <InlineRowDetails row={row} onRefresh={onRefresh} onOpenLabels={onOpenLabels} /> : null}
      </AnimatePresence>
    </>
  );
}

function FbaTable({
  rows,
  selectedFnsku,
  onSelect,
  onRefresh,
  onOpenLabels,
}: {
  rows: FbaSummaryRow[];
  selectedFnsku: string | null;
  onSelect: (fnsku: string) => void;
  onRefresh: () => void;
  onOpenLabels: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white">
      <div className={`${mainStickyHeaderClass} top-0`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-3 border-b border-gray-200 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-gray-400 sm:px-6">
          <span className="flex items-end gap-3">
            <span className="flex h-9 w-9 items-end justify-center" aria-hidden="true">
              <Barcode className="h-3.5 w-3.5" />
            </span>
            <span>Item</span>
          </span>
          <span className="flex items-center justify-end gap-4">
            <span className="flex items-center gap-1.5" aria-label="Ready to go column">
              <Check className="h-3.5 w-3.5" />
              <span>Ready</span>
            </span>
            <span className="flex items-center gap-1.5" aria-label="Needs attention column">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Attention</span>
            </span>
          </span>
          <span className="text-right">State</span>
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
            title="Refresh FBA board"
            aria-label="Refresh FBA board"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {rows.map((row) => (
        <FbaTableRow
          key={row.fnsku}
          row={row}
          isSelected={selectedFnsku === row.fnsku}
          onSelect={() => onSelect(selectedFnsku === row.fnsku ? '' : row.fnsku)}
          onRefresh={onRefresh}
          onOpenLabels={onOpenLabels}
        />
      ))}
    </div>
  );
}

export function FbaShipmentBoard({ statusFilter, refreshTrigger, searchQuery }: FbaShipmentBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<FbaSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFnsku, setSelectedFnsku] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qParam = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}&limit=500` : '?limit=500';
      const res = await fetch(`/api/fba/logs/summary${qParam}`);
      if (!res.ok) throw new Error('Failed to fetch FBA summary');
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load FBA summary');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  const visibleRows = useMemo(() => rows.filter((row) => matchesStatus(row, statusFilter)), [rows, statusFilter]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      setSelectedFnsku(null);
      return;
    }
    if (selectedFnsku && !visibleRows.some((row) => row.fnsku === selectedFnsku)) {
      setSelectedFnsku(null);
    }
  }, [selectedFnsku, visibleRows]);

  const openLabels = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'labels');
    router.replace(`/fba?${params.toString()}`);
  }, [router, searchParams]);

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-900" />
        <span className="text-sm text-gray-500">Loading FBA board…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-md items-center gap-3 border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  if (visibleRows.length === 0) {
    return <EmptyState searchQuery={searchQuery} />;
  }

  return (
    <FbaTable
      rows={visibleRows}
      selectedFnsku={selectedFnsku}
      onSelect={(fnsku) => setSelectedFnsku(fnsku || null)}
      onRefresh={load}
      onOpenLabels={openLabels}
    />
  );
}
