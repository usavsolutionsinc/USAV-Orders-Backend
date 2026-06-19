'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Barcode, ClipboardList, MapPin, Package } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { TestingScanBar } from '@/components/sidebar/receiving/TestingScanBar';
import { TestingRecentRail } from '@/components/sidebar/receiving/TestingRecentRail';
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
  /** Staff id used to theme the scan bar's input border (matches the shipping bar). */
  staffId?: string;
}

/**
 * Sidebar shell for the Testing sub-page.
 *
 * Strips the welcome/goal/UpNext chrome that {@link StationTesting} owns;
 * the tech is in test-mode, not pull-from-queue mode. Surface is just:
 *
 *   1. Header band — back chevron + "Testing" label + view switcher (icon pills)
 *   2. {@link ReceivingScanBar} — scans receiving carton QRs (PO# / RCV-id) and
 *      printed unit IDs (GS1 Digital Link or raw {SHORTSKU}-{YYWW}-{SEQ6}).
 *   3. {@link ReceivingRecentRail} — same live feed the History table shows.
 *
 * Resolved scans dispatch `receiving-select-line` (the canonical event the
 * receiving workspace listens for), so {@link TechTestingWorkspace} can pick
 * it up via the same listener LineEditPanel uses.
 */
/** Human label for the toast describing how a scan was matched. */
function viaFoundLabel(via: string | undefined): string | null {
  if (via === 'serial') return 'serial number';
  if (via === 'po') return 'PO number';
  if (via === 'tracking') return 'tracking number';
  return null; // explicit handle / unit-id scans don't need a callout
}

/** Icon + label + chip tint for the real-time "acknowledged as" indicator. */
function viaAckMeta(via: ResolvedVia): { label: string; Icon: typeof MapPin; chip: string } {
  switch (via) {
    case 'tracking':
      return { label: 'Tracking', Icon: MapPin, chip: 'bg-blue-50 text-blue-700 ring-blue-200' };
    case 'po':
      return { label: 'PO#', Icon: ClipboardList, chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' };
    case 'serial':
    case 'unit_id':
      return { label: via === 'unit_id' ? 'Unit ID' : 'Serial', Icon: Barcode, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
    case 'handle':
    case 'receiving_id':
    default:
      return { label: 'Carton', Icon: Package, chip: 'bg-slate-50 text-slate-700 ring-slate-200' };
  }
}

export function TestingSidebarPanel({
  selectedLineId: selectedLineIdProp,
  staffId,
}: Props) {
  const [scanValue, setScanValue] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  /** Armed search route — forces the next scan's type. null = auto-detect. */
  const [armedMode, setArmedMode] = useState<ForcedTestingType | null>(null);
  /** Real-time "acknowledged as" indicator: what the last scan was recognised as. */
  const [lastAck, setLastAck] = useState<{ via: ResolvedVia; value: string } | null>(null);
  /** Multi-line carton picker state. Set when a scan returns >1 line. */
  const [picker, setPicker] = useState<ResolvedTestingScan & { kind: 'multi' } | null>(null);
  // Self-track the selection when the parent doesn't pass one down — keeps
  // the rail highlight in lockstep with whichever line is open in the
  // workspace without prop drilling through RouteShell. Also caches the
  // full row so the rail can pin it (visible) even when it's older than
  // the top `limit` rows (e.g. a localStorage restore of an old line).
  const [internalSelectedRow, setInternalSelectedRow] =
    useState<ReceivingLineRow | null>(null);
  const internalSelectedId = internalSelectedRow?.id ?? null;
  const selectedLineId = selectedLineIdProp ?? internalSelectedId;

  useEffect(() => {
    if (selectedLineIdProp !== undefined) return; // Parent owns selection
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReceivingSelectLineDetail>).detail;
      const { row } = readSelectLineDetail(detail);
      setInternalSelectedRow(row ?? null);
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [selectedLineIdProp]);

  // Single concurrent scan guard — second submit while one is in flight is
  // ignored, mirroring the receiving sidebar's lookup-in-flight counter.
  const inFlightRef = useRef(false);

  const runScan = useCallback(
    async (rawValue: string, forcedType: ForcedTestingType | null) => {
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
              toast.success(`Found via ${label}`, {
                description: 'Opened the matching receiving line.',
              });
            }
            break;
          }
          case 'multi': {
            // Multi-item PO — let the tech pick which line to test.
            setPicker(result);
            setArmedMode(null);
            if (result.via) setLastAck({ via: result.via, value });
            const label = viaFoundLabel(result.via);
            if (label) {
              toast.success(`Found via ${label}`, { description: 'Pick the line to test.' });
            }
            break;
          }
          case 'not_found': {
            const what = forcedType === 'po' ? 'PO' : forcedType === 'tracking' ? 'tracking' : forcedType === 'serial' ? 'serial' : 'receiving line';
            toast.error('Not found', {
              description: `No ${what} match for "${result.query}".`,
            });
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
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    void runScan(scanValue, armedMode);
  }, [runScan, scanValue, armedMode]);

  // Arm/disarm a search route. Clicking a route while the field already holds a
  // value searches immediately (mirrors the shipping station's mode buttons).
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

  // External focus trigger — match the receiving sidebar's convention so
  // Quick Access chips that navigate to Testing can hot-focus the bar.
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>('[data-testing-scan] input');
        input?.focus();
      });
    };
    window.addEventListener('testing-focus-scan', handler);
    return () => window.removeEventListener('testing-focus-scan', handler);
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      {/* Scan bar — same chrome + mode toggles as the shipping StationScanBar.
          Tap Tracking / PO# / Serial to force the next scan's search type, or
          leave unarmed to auto-detect. Top padding matches the shipping scan
          band (`py-1.5`) so the bar holds its vertical position across modes. */}
      <div className={`${SIDEBAR_GUTTER} pt-1.5 pb-2`}>
        <TestingScanBar
          value={scanValue}
          onChange={setScanValue}
          onSubmit={handleSubmit}
          isResolving={isResolving}
          staffId={staffId}
          armedMode={armedMode}
          onToggleMode={toggleMode}
        />

        {/* Real-time acknowledgment — what the last scan was recognised as. */}
        {lastAck ? (() => {
          const meta = viaAckMeta(lastAck.via);
          return (
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${meta.chip}`}
              >
                <meta.Icon className="h-3 w-3 shrink-0" />
                {meta.label}
              </span>
              <span className="min-w-0 truncate font-mono text-micro font-bold text-gray-600" title={lastAck.value}>
                {lastAck.value}
              </span>
            </div>
          );
        })() : null}
      </div>

      {/* Multi-line picker — tiny inline list when a PO has >1 receiving_line */}
      {picker ? (
        <div className={`border-b border-amber-200 bg-amber-50 ${SIDEBAR_GUTTER} py-2`}>
          <p className="mb-1 text-eyebrow font-black uppercase tracking-widest text-amber-700">
            {picker.via === 'serial'
              ? `Pick a unit — ${picker.rows.length} serial matches`
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
                  className="w-full rounded-md bg-white px-2 py-1.5 text-left text-caption font-bold text-gray-800 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
                >
                  <span className="block truncate">{row.item_name || row.sku || `Line #${row.id}`}</span>
                  <span className="block text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
                    {row.quantity_received}/{row.quantity_expected ?? '?'} ·{' '}
                    {row.workflow_status || 'EXPECTED'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="mt-1.5 text-eyebrow font-black uppercase tracking-widest text-amber-600 hover:text-amber-800"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Scrollable recent rail — min-h-0 lets the flex child shrink below its
          content so overflow-y-auto actually engages; overscroll-contain keeps
          the wheel/trackpad gesture inside the rail instead of chaining to the
          page once it bottoms out. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TestingRecentRail
          selectedLineId={selectedLineId}
          selectedRow={internalSelectedRow}
          testerId={staffId ? Number(staffId) : null}
        />
      </div>
    </div>
  );
}
