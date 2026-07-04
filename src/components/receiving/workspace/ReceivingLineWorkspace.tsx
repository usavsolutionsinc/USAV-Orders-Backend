'use client';

import { useEffect, useState } from 'react';
import { LineEditPanel } from './LineEditPanel';
import { TriagePanel } from '../triage/TriagePanel';
import { ReceivingProgressStepper } from './ReceivingProgressStepper';
import { TriageProgressStepper } from './TriageProgressStepper';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Which de-coupled right-pane panel to render. */
type ReceivingWorkspaceVariant = 'unbox' | 'triage';

const LABEL_PRINTED_KEY = (lineId: number) => `receiving-label-printed:${lineId}`;

function readLabelPrinted(lineId: number): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.localStorage.getItem(LABEL_PRINTED_KEY(lineId));
  } catch {
    return false;
  }
}
interface NavState {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

interface Props {
  row: ReceivingLineRow;
  staffId: string;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
  /** Nav state mirrored from the sidebar via `receiving-workspace-nav-state`. */
  nav: NavState | null;
  /** Which workspace mode — `triage` hides unbox-only sections (photos, claim,
   *  label, print·receive, serial scan). Defaults to the full `unbox` editor. */
  variant?: ReceivingWorkspaceVariant;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * Right-pane focused work-item view for a single receiving line. The PO
 * identity hero that used to sit on top has been removed — the global header
 * carries the PO identity. The workspace now leads with the progress stepper,
 * then the `LineEditPanel` body (whose icon-only action bar is the third row).
 * State (current edits, accordion toggles, audit modal) lives entirely inside
 * the panel — the workspace is the container shell.
 *
 * Closing dispatches `receiving-workspace-close`; the sidebar reacts by
 * clearing its `selectedLine`/`scanMatchedRows`/`poContext` so both panes
 * converge on an empty state.
 */
export function ReceivingLineWorkspace({
  row,
  staffId,
  accordionBootstrap,
  scanDriven,
  nav,
  variant = 'unbox',
  onPrev,
  onNext,
  onClose,
}: Props) {
  // Print step (#5) flips done once a label is printed for THIS line. Tracked
  // in localStorage so the step survives refresh / re-mount without needing a
  // schema column. LineEditPanel dispatches `receiving-label-printed` after a
  // successful print; we re-read on every line change.
  const [labelPrinted, setLabelPrinted] = useState(() => readLabelPrinted(row.id));
  useEffect(() => {
    setLabelPrinted(readLabelPrinted(row.id));
  }, [row.id]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line_id?: number }>).detail;
      if (detail?.line_id === row.id) setLabelPrinted(true);
    };
    window.addEventListener('receiving-label-printed', handler);
    return () => window.removeEventListener('receiving-label-printed', handler);
  }, [row.id]);

  // Record this open into the operator's recents (server-backed, per-staff) so
  // the unbox sidebar's "Viewed" pill can list recently-opened lines. Fire-and-
  // forget — a failure never blocks the workspace. Upsert keys on (staff, line),
  // so re-opening just bumps viewed_at.
  useEffect(() => {
    if (!(row.id > 0)) return;
    void fetch('/api/receiving-lines/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiving_line_id: row.id, receiving_id: row.receiving_id ?? null }),
    }).catch(() => {});
  }, [row.id, row.receiving_id]);

  return (
    // Plain wrapper — NO per-line key/crossfade. Switching between sibling lines
    // of the same carton must be an in-place update, not a remount: the outer
    // ReceivingRightPane crossfade is keyed on the CARTON (receiving_id), and the
    // controller re-seeds its per-line state on `row.id` change via effects. A
    // `key={row.id}` + enter animation here re-mounted the whole workspace on
    // every line click (the "re-rendering the whole page" jank). Carton→carton
    // transitions still crossfade via the outer AnimatePresence.
    <div
      className="flex h-full w-full flex-col bg-surface-canvas"
      data-testid="receiving-workspace"
      // E2E hook: distinguishes a matched-PO carton ('zoho_po') from an unfound
      // intake carton ('unmatched'), so the scan-resolution spec can assert a
      // scanned PO# opens the PO workspace and never the Unfound flow.
      data-receiving-source={String(row.receiving_source ?? '')}
    >
      {/* Step-by-step progress stepper — first row in the workspace now that
          the PO identity hero has been removed. The global header carries the
          PO identity; this stepper + the action bar below it form the second
          and third rows. Triage and unbox are different stations with
          different jobs (docs/receiving-triage-redesign-plan.md §3.2) — each
          gets its own stepper rather than sharing the unbox one. */}
      {variant === 'triage' ? (
        <TriageProgressStepper row={row} />
      ) : (
        <ReceivingProgressStepper
          row={row}
          photoCount={Math.max(0, Number(row.photo_count ?? 0))}
          serialCount={Array.isArray(row.serials) ? row.serials.length : 0}
          isComplete={
            String(row.workflow_status || '').toUpperCase() === 'DONE' ||
            String(row.workflow_status || '').toUpperCase() === 'PASSED'
          }
          labelPrinted={labelPrinted}
        />
      )}

      {/* ── Body — two de-coupled panels, one per archetype. Triage (the
          identify-before-unbox pass) is its own lean composition; Unbox is the
          full editor that handles both matched (Zoho PO) and unmatched
          (Ecwid-pick) cartons, branching internally on row.receiving_source so
          its chrome stays identical across those two flows. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {variant === 'triage' ? (
          <TriagePanel row={row} staffId={staffId} onClose={onClose} />
        ) : (
          <LineEditPanel row={row} staffId={staffId} itemTotal={nav?.total} />
        )}
      </div>
    </div>
  );
}
