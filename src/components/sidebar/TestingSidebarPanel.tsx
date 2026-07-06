'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { Barcode, Hash, MapPin, Package, Pencil } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { TestingScanBar } from '@/components/sidebar/receiving/TestingScanBar';
import { TestingRecentRail } from '@/components/sidebar/receiving/TestingRecentRail';
import { TechRailSearchBar } from '@/components/sidebar/tech/TechRailSearchBar';
import { useIsMobile } from '@/hooks';
import {
  resolveTestingScan,
  type ResolvedTestingScan,
  type ResolvedVia,
  type ForcedTestingType,
} from '@/lib/testing/resolve-testing-scan';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  readSelectLineDetail,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

interface Props {
  /**
   * Optional override for the rail's highlighted line. When omitted, the
   * sidebar tracks selection itself by listening for `receiving-select-line`.
   */
  selectedLineId?: number | null;
  /** Staff id used to theme the scan bar's input border. */
  staffId?: string;
}

function viaFoundLabel(via: string | undefined): string | null {
  if (via === 'serial') return 'serial number';
  if (via === 'po') return 'PO number';
  if (via === 'tracking') return 'tracking number';
  if (via === 'sku') return 'product SKU';
  return null;
}

function viaAckMeta(via: ResolvedVia): { label: string; Icon: typeof MapPin; chip: string } {
  switch (via) {
    case 'tracking':
      return { label: 'Tracking', Icon: MapPin, chip: 'bg-blue-50 text-blue-700 ring-blue-200' };
    case 'po':
      return { label: 'PO#', Icon: Hash, chip: 'bg-surface-canvas text-text-muted ring-border-soft' };
    case 'sku':
      return { label: 'SKU', Icon: Pencil, chip: 'bg-yellow-50 text-yellow-700 ring-yellow-200' };
    case 'serial':
    case 'unit_id':
      return { label: via === 'unit_id' ? 'Unit ID' : 'Serial', Icon: Barcode, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
    case 'handle':
    case 'receiving_id':
    default:
      return { label: 'Carton', Icon: Package, chip: 'bg-surface-canvas text-text-muted ring-border-soft' };
  }
}

/**
 * Tech sidebar for Testing mode — receiving scan band plus the To Test /
 * Tested activity rail. Shares the same shell anatomy as
 * {@link ShippingSidebarPanel} (scan band, scrollable rail, bottom filter)
 * but uses testing-specific rails and scan resolution instead of Up Next orders.
 */
export function TestingSidebarPanel({
  selectedLineId: selectedLineIdProp,
  staffId,
}: Props) {
  const isMobile = useIsMobile();
  const [railFilter, setRailFilter] = useState('');
  const [scanValue, setScanValue] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [armedMode, setArmedMode] = useState<ForcedTestingType | null>(null);
  const [lastAck, setLastAck] = useState<{ via: ResolvedVia; value: string } | null>(null);
  const [picker, setPicker] = useState<ResolvedTestingScan & { kind: 'multi' } | null>(null);
  const [internalSelectedRow, setInternalSelectedRow] =
    useState<ReceivingLineRow | null>(null);
  const internalSelectedId = internalSelectedRow?.id ?? null;
  const selectedLineId = selectedLineIdProp ?? internalSelectedId;

  useEffect(() => {
    if (selectedLineIdProp !== undefined) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReceivingSelectLineDetail>).detail;
      const { row } = readSelectLineDetail(detail);
      setInternalSelectedRow(row ?? null);
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [selectedLineIdProp]);

  const inFlightRef = useRef(false);

  const runScan = useCallback(async (rawValue: string, forcedType: ForcedTestingType | null) => {
    const value = rawValue.trim();
    if (!value || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsResolving(true);
    try {
      const result = await resolveTestingScan(value, { forcedType });
      switch (result.kind) {
        case 'line': {
          dispatchSelectLine(result.row);
          setScanValue('');
          setArmedMode(null);
          if (result.via) setLastAck({ via: result.via, value });
          const label = viaFoundLabel(result.via);
          if (label) {
            toast.success(`Found via ${label}`, { description: 'Opened the matching receiving line.' });
          }
          break;
        }
        case 'multi': {
          setPicker(result);
          setArmedMode(null);
          if (result.via) setLastAck({ via: result.via, value });
          const label = viaFoundLabel(result.via);
          if (label) toast.success(`Found via ${label}`, { description: 'Pick the line to test.' });
          break;
        }
        case 'not_found': {
          const what =
            forcedType === 'po' ? 'PO'
              : forcedType === 'tracking' ? 'tracking'
                : forcedType === 'serial' ? 'serial'
                  : 'receiving line';
          toast.error('Not found', { description: `No ${what} match for "${result.query}".` });
          break;
        }
        case 'error': {
          toast.error('Lookup failed', { description: result.message });
          break;
        }
      }
    } finally {
      inFlightRef.current = false;
      setIsResolving(false);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    void runScan(scanValue, armedMode);
  }, [runScan, scanValue, armedMode]);

  const toggleMode = useCallback(
    (mode: ForcedTestingType) => {
      const turningOff = armedMode === mode;
      const next = turningOff ? null : mode;
      setArmedMode(next);
      const pending = scanValue.trim();
      if (next && pending) {
        void runScan(scanValue, next);
        return;
      }
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('[data-testing-scan] input')?.focus();
      });
    },
    [armedMode, scanValue, runScan],
  );

  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('[data-testing-scan] input')?.focus();
      });
    };
    window.addEventListener('testing-focus-scan', handler);
    return () => window.removeEventListener('testing-focus-scan', handler);
  }, []);

  const scanBarBlock = (
    <TestingScanBar
      value={scanValue}
      onChange={setScanValue}
      onSubmit={handleSubmit}
      isResolving={isResolving}
      staffId={staffId}
      armedMode={armedMode}
      onToggleMode={toggleMode}
    />
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface-card">
      {!isMobile ? (
        <div className={`${SIDEBAR_GUTTER} pt-1.5 pb-2`}>
          {scanBarBlock}
          {lastAck ? (() => {
            const meta = viaAckMeta(lastAck.via);
            return (
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${meta.chip}`}>
                  <meta.Icon className="h-3 w-3 shrink-0" />
                  {meta.label}
                </span>
                <span className="min-w-0 truncate font-mono text-micro font-bold text-text-muted" title={lastAck.value}>
                  {lastAck.value}
                </span>
              </div>
            );
          })() : null}
        </div>
      ) : null}

      {picker ? (
        <div className={`border-b border-amber-200 bg-amber-50 ${SIDEBAR_GUTTER} py-2`}>
          <p className="mb-1 text-eyebrow font-black uppercase tracking-widest text-amber-700">
            {picker.via === 'serial'
              ? `Pick a unit — ${picker.rows.length} serial matches`
              : picker.via === 'sku'
                ? `Pick a line — ${picker.rows.length} pre-packed lines for this SKU`
                : `Pick a line — ${picker.rows.length} items on this PO`}
          </p>
          <ul className="space-y-1">
            {picker.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => {
                    dispatchSelectLine(row);
                    setPicker(null);
                    setScanValue('');
                  }}
                  className="ds-raw-button w-full rounded-md bg-surface-card px-2 py-1.5 text-left text-caption font-bold text-text-default ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
                >
                  <span className="block truncate">{row.item_name || row.sku || `Line #${row.id}`}</span>
                  <span className="block text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                    {row.quantity_received}/{row.quantity_expected ?? '?'} · {row.workflow_status || 'EXPECTED'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPicker(null)}
            className="mt-1.5 h-auto px-0 text-eyebrow font-black uppercase tracking-widest text-amber-600 hover:bg-transparent hover:text-amber-800"
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TestingRecentRail
          selectedLineId={selectedLineId}
          selectedRow={internalSelectedRow}
          testerId={staffId ? Number(staffId) : null}
          filterText={railFilter}
        />
      </div>

      <TechRailSearchBar
        value={railFilter}
        onChange={setRailFilter}
        placeholder="Filter lines…"
      />

      {isMobile ? (
        <div className={`flex-shrink-0 border-t border-border-hairline bg-surface-card ${SIDEBAR_GUTTER} pb-[max(1.125rem,env(safe-area-inset-bottom))] pt-3`}>
          {scanBarBlock}
        </div>
      ) : null}
    </div>
  );
}
