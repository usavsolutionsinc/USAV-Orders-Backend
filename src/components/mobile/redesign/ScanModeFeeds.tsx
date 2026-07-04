'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronRight, Flag, History, Loader2, Package, QrCode, Trash2 } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';
import { SectionHeader } from '@/components/mobile/redesign/DesignSystem';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ScanResultRow, type ScanFeedItem } from '@/components/mobile/feed/rows/ScanResultRow';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { unitStatusToVerdict, type TestingVerdict } from '@/components/receiving/workspace/TestingStatusPills';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import { Button } from '@/design-system/primitives';

/**
 * Mobile /m/scan recent-feed panels for the Receiving and Testing modes. These
 * pull from the SAME desktop endpoints + react-query keys as the desktop
 * sidebar rails, so the lists stay cache-coherent and a door/PO scan that
 * invalidates a key updates both surfaces:
 *
 *   Receiving · Unfound    → /api/receiving/unfound-queue   (TriageUnfoundList)
 *   Receiving · Prioritize → /api/receiving-lines?view=scanned&sort=priority (ReceivingScannedRail)
 *   Testing   · Recent     → /api/receiving-lines?view=testing&tester=… (TestingRecentRail)
 *
 * Each desktop `ReceivingLineRow` is mapped to the shared {@link ScanFeedItem}
 * so it renders through {@link ScanResultRow} (product title on top, SKU below).
 */

// ── shared mappers ──────────────────────────────────────────────────────────

function receivingStatusLabel(row: ReceivingLineRow): string {
  const ws = String(row.workflow_status ?? '').toUpperCase();
  if (ws === 'ARRIVED') return 'Scanned';
  if (ws === 'RECEIVED') return 'Received';
  if (ws === 'EXPECTED') return 'Expected';
  if (!ws) return 'Scanned';
  return ws.charAt(0) + ws.slice(1).toLowerCase();
}

function receivingState(row: ReceivingLineRow): ScanFeedItem['state'] {
  if (row.receiving_source === 'unmatched') return 'warn';
  const full =
    row.quantity_expected != null &&
    row.quantity_expected > 0 &&
    row.quantity_received >= row.quantity_expected;
  return full ? 'ok' : 'warn';
}

function testingStatusLabel(row: ReceivingLineRow): string {
  const ws = String(row.workflow_status ?? '').toUpperCase();
  if (ws.startsWith('PASS') || ws === 'DONE') return 'Pass';
  if (ws.startsWith('FAIL') || ws.startsWith('SCRAP') || ws.startsWith('RTV')) return 'Failed';
  if (ws.startsWith('TEST')) return 'Testing';
  return ws ? ws.charAt(0) + ws.slice(1).toLowerCase() : 'Tested';
}

function testingState(row: ReceivingLineRow): ScanFeedItem['state'] {
  const ws = String(row.workflow_status ?? '').toUpperCase();
  if (ws.startsWith('FAIL') || ws.startsWith('SCRAP') || ws.startsWith('RTV')) return 'error';
  if (ws.startsWith('TEST')) return 'warn';
  return 'ok';
}

/**
 * "Tested" quantity for a line — mirrors the desktop `TestingRecentRail.getTestedQty`.
 * Prefers the API's recorded-verdict count (`tested_count`, scoped to the tester);
 * falls back to the terminal-status heuristic for rows without it. The serial
 * rows in this feed don't carry per-unit verdict statuses, so counting them
 * (the old approach) wrongly read 0/N for a line that workflow_status says passed.
 */
function getTestedQty(row: ReceivingLineRow): number {
  if (typeof row.tested_count === 'number') {
    return Math.min(row.tested_count, row.quantity_received);
  }
  const v = String(row.workflow_status || '').trim().toUpperCase();
  const isTested = ['PASSED', 'DONE', 'FAILED', 'SCRAP', 'RTV'].some((s) => v.startsWith(s));
  return isTested ? row.quantity_received : 0;
}

/** Line-level verdict from workflow_status — fallback for per-serial badges when
 *  the serial's own status doesn't carry a verdict. */
function lineVerdict(row: ReceivingLineRow): TestingVerdict | null {
  const v = String(row.workflow_status || '').trim().toUpperCase();
  if (v.startsWith('PASS') || v === 'DONE') return 'PASS';
  if (v.startsWith('FAIL') || v.startsWith('SCRAP') || v.startsWith('RTV') || v.startsWith('HOLD')) return 'TESTING_FAILED';
  if (v.startsWith('TEST') || v === 'IN_TEST') return 'TEST_AGAIN';
  return null;
}

function lineToScanItem(
  row: ReceivingLineRow,
  opts: { statusLabel: string; state: ScanFeedItem['state']; meta?: string | null },
): ScanFeedItem {
  const whenIso = row.last_activity_at ?? row.created_at ?? null;
  return {
    id: `line-${row.id}`,
    primary: row.sku ?? row.tracking_number ?? String(row.id),
    title: row.item_name ?? row.sku ?? 'Item',
    subtitle: row.sku ?? null,
    at: whenIso ? new Date(whenIso) : new Date(),
    state: opts.state,
    statusLabel: opts.statusLabel,
    meta: opts.meta ?? null,
    href: row.receiving_id ? `/m/r/${row.receiving_id}` : null,
  };
}

// ── shared list shell ───────────────────────────────────────────────────────

function FeedList({
  items,
  isLoading,
  empty,
}: {
  items: ScanFeedItem[];
  isLoading: boolean;
  empty: string;
}) {
  if (isLoading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-blue-300">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-12 text-center opacity-40">
        <History className="mx-auto mb-3 h-10 w-10 text-blue-200" />
        <p className="text-xs font-black uppercase tracking-widest text-blue-300">{empty}</p>
      </div>
    );
  }
  return (
    <div className="pb-32">
      {items.map((item) => (
        <ScanResultRow key={item.id} item={item} />
      ))}
    </div>
  );
}

// ── Receiving triage (Unfound / Prioritize) ─────────────────────────────────

interface UnfoundQueueRow {
  source_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
}

type TriageView = 'unfound' | 'found';

const TRIAGE_OPTIONS: ReadonlyArray<ViewDropdownOption<TriageView>> = [
  { value: 'unfound', label: 'Unfound', icon: AlertTriangle },
  { value: 'found', label: 'Prioritize', icon: Flag },
];

export function ReceivingTriagePanel() {
  const [view, setView] = useState<TriageView>('found');

  // Prioritize — door-scanned cartons awaiting unbox, priority-sorted. Same
  // endpoint + key as the desktop ReceivingScannedRail.
  const prioritize = useQuery<ScanFeedItem[]>({
    queryKey: ['receiving-lines-table', 'rail', 'scanned', 'triage', 'priority', ''],
    queryFn: async () => {
      const res = await fetch(
        '/api/receiving-lines?view=scanned&sort=priority&include=serials&limit=500&offset=0',
      );
      if (!res.ok) throw new Error('fetch failed');
      const data = (await res.json()) as { receiving_lines?: ReceivingLineRow[] };
      return (data.receiving_lines ?? [])
        .filter((r) => r.receiving_source !== 'unmatched')
        .map((r) =>
          lineToScanItem(r, {
            statusLabel: receivingStatusLabel(r),
            state: receivingState(r),
            meta: `${r.quantity_received}/${r.quantity_expected ?? '?'}`,
          }),
        );
    },
    staleTime: 15_000,
    enabled: view === 'found',
  });

  // Unfound — cartons scanned at the door that Zoho can't match to a PO. Same
  // endpoint + key as the desktop TriageUnfoundList.
  const unfound = useQuery<ScanFeedItem[]>({
    queryKey: ['receiving', 'triage', 'unfound-list', ''],
    queryFn: async () => {
      const res = await fetch(
        '/api/receiving/unfound-queue?kind=unmatched_receiving&checked=false&limit=200',
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('unfound queue fetch failed');
      const data = (await res.json()) as { rows?: UnfoundQueueRow[] };
      return (data.rows ?? [])
        .filter((r) => Number.isFinite(Number(r.source_id)))
        .map((r) => ({
          id: `unfound-${r.source_id}`,
          primary: r.context ?? r.source_id,
          title: r.product_title ?? 'Unfound PO',
          subtitle: r.context ?? null,
          at: new Date(r.created_at),
          state: 'warn' as const,
          statusLabel: 'Unfound',
          meta: null,
          href: `/m/r/${r.source_id}`,
        }));
    },
    staleTime: 15_000,
    enabled: view === 'unfound',
  });

  const active = view === 'unfound' ? unfound : prioritize;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* View picker — Unfound / Prioritize as a compact dropdown. Swiping
          between top-level scan modes is owned by the parent UniversalScan. */}
      <div className="-mt-1 px-6 pb-2">
        <ViewDropdown
          options={TRIAGE_OPTIONS}
          value={view}
          onChange={setView}
          size="sm"
          textTransform="capitalize"
          className="w-40"
          buttonClassName="flex h-8 w-full items-center gap-2 rounded-lg border border-border-default bg-surface-card pl-2.5 pr-9 text-left text-xs font-black capitalize tracking-wide text-blue-950 outline-none transition-colors hover:bg-surface-hover"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FeedList
          items={active.data ?? []}
          isLoading={active.isLoading}
          empty={view === 'unfound' ? 'Nothing to identify' : 'No scanned cartons'}
        />
      </div>
    </div>
  );
}

// ── Testing recent feed ─────────────────────────────────────────────────────

export function TestingRecentPanel() {
  const { user } = useAuth();
  const testerId = user?.staffId ?? 0;
  const hasTester = testerId > 0;
  const [selected, setSelected] = useState<ReceivingLineRow | null>(null);

  const recent = useQuery<ReceivingLineRow[]>({
    queryKey: ['receiving-lines-table', 'rail', 'testing', String(hasTester ? testerId : 'all')],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '12', offset: '0', include: 'serials' });
      if (hasTester) {
        params.set('view', 'testing');
        params.set('tester', String(testerId));
      } else {
        params.set('view', 'activity');
      }
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = (await res.json()) as { receiving_lines?: ReceivingLineRow[] };
      return data.receiving_lines ?? [];
    },
    staleTime: 15_000,
  });

  const rows = recent.data ?? [];

  return (
    <div>
      <div className="px-6">
        <SectionHeader title={hasTester ? 'Recently Tested' : 'Recent Activity'} />
      </div>
      {recent.isLoading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-blue-300">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center opacity-40">
          <History className="mx-auto mb-3 h-10 w-10 text-blue-200" />
          <p className="text-xs font-black uppercase tracking-widest text-blue-300">No tested units yet</p>
        </div>
      ) : (
        <div className="pb-2">
          {rows.map((r) => {
            // Tap a tested line → open its detail sheet (no navigation), so the
            // href is dropped in favour of the onClick.
            const item = { ...lineToScanItem(r, { statusLabel: testingStatusLabel(r), state: testingState(r) }), href: null };
            return <ScanResultRow key={item.id} item={item} onClick={() => setSelected(r)} />;
          })}
        </div>
      )}
      <TestingRecentSheet line={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Testing detail sheet — desktop-style tested-unit info ────────────────────

const VERDICT_META: Record<TestingVerdict, { label: string; cls: string }> = {
  PASS: { label: 'Pass', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  TEST_AGAIN: { label: 'Test Again', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  TESTING_FAILED: { label: 'Failed', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};

function TestingStatField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-canvas px-3 py-2.5">
      <p className="text-micro font-black uppercase tracking-[0.15em] text-blue-300">{label}</p>
      <p className="mt-1 truncate text-sm font-black tracking-tight text-blue-950">{value}</p>
    </div>
  );
}

type TestingSerial = NonNullable<ReceivingLineRow['serials']>[number];

/**
 * Detail for a recently-tested line — mirrors what the desktop tech workspace
 * shows for a tested line: product + SKU, status / condition / tested qty, and
 * each unit's serial with its verdict badge (PASS / TEST AGAIN / FAILED).
 * Tapping a serial opens a stacked sheet with a Delete action (reuses the same
 * `DELETE /api/receiving/scan-serial` endpoint as the inline testing panel).
 */
function TestingRecentSheet({ line, onClose }: { line: ReceivingLineRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  // Keep the last line mounted through the close animation (no content blank).
  const [shown, setShown] = useState<ReceivingLineRow | null>(line);
  useEffect(() => {
    if (line) setShown(line);
  }, [line]);

  const [selectedSerial, setSelectedSerial] = useState<TestingSerial | null>(null);
  const [shownSerial, setShownSerial] = useState<TestingSerial | null>(null);
  useEffect(() => {
    if (selectedSerial) setShownSerial(selectedSerial);
  }, [selectedSerial]);
  const [deleting, setDeleting] = useState(false);

  const row = shown;
  const serials = row?.serials ?? [];
  const tested = row ? getTestedQty(row) : 0;
  const fallbackVerdict = row ? lineVerdict(row) : null;

  async function handleDelete(serial: TestingSerial) {
    if (!row || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serial_unit_id: serial.id, receiving_line_id: row.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not remove serial');
        return;
      }
      toast.success('Serial removed');
      // Drop it locally for instant feedback, then refresh the desktop-shared feed.
      setShown((prev) => (prev ? { ...prev, serials: (prev.serials ?? []).filter((x) => x.id !== serial.id) } : prev));
      setSelectedSerial(null);
      void queryClient.invalidateQueries({ queryKey: ['receiving-lines-table', 'rail', 'testing'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setDeleting(false);
    }
  }

  const detailVerdict = shownSerial
    ? unitStatusToVerdict(shownSerial.current_status) ?? fallbackVerdict
    : null;
  const detailMeta = detailVerdict ? VERDICT_META[detailVerdict] : null;

  return (
    <>
      <BottomSheet open={line != null} onClose={onClose} maxWidth="32rem">
        {row && (
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Package className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black leading-snug tracking-tight text-blue-950">
                  {row.item_name ?? row.sku ?? 'Tested Item'}
                </p>
                {row.sku && (
                  <p className="mt-0.5 truncate text-xs font-black uppercase tracking-wider text-blue-400">SKU {row.sku}</p>
                )}
              </div>
            </div>

            {/* Status / condition / tested-count */}
            <div className="grid grid-cols-3 gap-2">
              <TestingStatField label="Status" value={testingStatusLabel(row)} />
              <TestingStatField label="Condition" value={conditionGradeTableLabel(row.condition_grade) || '—'} />
              <TestingStatField label="Tested" value={`${tested}/${row.quantity_received}`} />
            </div>

            {/* Units + per-serial verdicts — tap a serial to manage it. */}
            <div>
              <SectionHeader title="Units" />
              {serials.length > 0 ? (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {serials.map((s) => {
                    const verdict = unitStatusToVerdict(s.current_status) ?? fallbackVerdict;
                    const meta = verdict ? VERDICT_META[verdict] : null;
                    return (
                      // ds-raw-button: text-left serial row (title left, verdict chip + chevron right) — not a DS Button
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSerial(s)}
                        className="ds-raw-button flex w-full items-center justify-between gap-3 rounded-2xl border border-blue-50 bg-surface-card px-3 py-2.5 text-left transition-colors active:bg-blue-50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <QrCode className="h-4 w-4 shrink-0 text-blue-300" />
                          <span className="truncate font-mono text-sm font-bold text-blue-950">
                            {s.serial_number || '—'}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-micro font-black uppercase tracking-wider ${
                              meta ? meta.cls : 'border-border-soft bg-surface-canvas text-text-soft'
                            }`}
                          >
                            {meta ? meta.label : 'Untested'}
                          </span>
                          <ChevronRight className="h-4 w-4 text-blue-200" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-surface-canvas px-4 py-6 text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-blue-300">No serials recorded</p>
                </div>
              )}
            </div>

            <Button variant="ghost" onClick={onClose} className="mt-1 w-full text-blue-400">
              Done
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* Stacked serial-action sheet — tap a serial → manage / delete it. */}
      <BottomSheet open={selectedSerial != null} onClose={() => setSelectedSerial(null)} level={1} title="Serial">
        {shownSerial && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <QrCode className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-base font-black tracking-tight text-blue-950">
                  {shownSerial.serial_number || '—'}
                </p>
                <span
                  className={`mt-1 inline-flex rounded-full border px-2.5 py-0.5 text-micro font-black uppercase tracking-wider ${
                    detailMeta ? detailMeta.cls : 'border-border-soft bg-surface-canvas text-text-soft'
                  }`}
                >
                  {detailMeta ? detailMeta.label : 'Untested'}
                </span>
              </div>
            </div>

            <Button
              variant="danger"
              onClick={() => void handleDelete(shownSerial)}
              loading={deleting}
              icon={<Trash2 className="h-4 w-4" />}
              className="w-full"
            >
              {deleting ? 'Removing' : 'Delete serial'}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
