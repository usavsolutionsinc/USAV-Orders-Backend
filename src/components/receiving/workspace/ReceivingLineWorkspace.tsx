'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LineEditPanel } from './LineEditPanel';
import { ReceivingProgressStepper } from './ReceivingProgressStepper';
import type { ReceivingWorkspaceVariant } from './workspace-capabilities';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

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
    <motion.div
      key={row.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-full flex-col bg-gray-50"
    >
      {/* Step-by-step progress stepper — first row in the workspace now that
          the PO identity hero has been removed. The global header carries the
          PO identity; this stepper + the action bar below it form the second
          and third rows. */}
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

      {/* ── Body — LineEditPanel handles both matched (Zoho PO) and
          unmatched (Ecwid-pick) cartons. Branches internally on
          row.receiving_source so the chrome (header, chips, sticky bar,
          print, audit, claim) stays identical across the two flows. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <LineEditPanel
          row={row}
          staffId={staffId}
          itemTotal={nav?.total}
          variant={variant}
          onClose={onClose}
        />
      </div>
    </motion.div>
  );
}
