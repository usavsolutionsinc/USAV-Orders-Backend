'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { TestingScanBar } from '@/components/sidebar/receiving/TestingScanBar';
import { TestingRecentRail } from '@/components/sidebar/receiving/TestingRecentRail';
import {
  resolveTestingScan,
  type ResolvedTestingScan,
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
export function TestingSidebarPanel({
  selectedLineId: selectedLineIdProp,
  staffId,
}: Props) {
  const [scanValue, setScanValue] = useState('');
  const [isResolving, setIsResolving] = useState(false);
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

  const handleSubmit = useCallback(async () => {
    const value = scanValue.trim();
    if (!value || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsResolving(true);
    try {
      const result = await resolveTestingScan(value);
      switch (result.kind) {
        case 'line': {
          dispatchSelectLine(result.row);
          setScanValue('');
          break;
        }
        case 'multi': {
          // Multi-item PO — let the tech pick which line to test.
          setPicker(result);
          break;
        }
        case 'not_found': {
          toast.error('Not found', {
            description: `No receiving line matches "${result.query}".`,
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
  }, [scanValue]);

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
      {/* Scan bar — testing-only variant of StationScanBar. Single Package
          icon on the left, no mode-toggle buttons on the right. Testing
          accepts every input shape through `resolveTestingScan`, so the
          multi-mode arming the shipping bar shows would be misleading. */}
      <div className="px-5 pt-4 pb-2">
        <TestingScanBar
          value={scanValue}
          onChange={setScanValue}
          onSubmit={() => void handleSubmit()}
          isResolving={isResolving}
          staffId={staffId}
        />
      </div>

      {/* Multi-line picker — tiny inline list when a PO has >1 receiving_line */}
      {picker ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 text-eyebrow font-black uppercase tracking-widest text-amber-700">
            Pick a line — {picker.rows.length} items on this PO
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

      {/* Scrollable recent rail */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TestingRecentRail
          selectedLineId={selectedLineId}
          selectedRow={internalSelectedRow}
        />
      </div>
    </div>
  );
}
