'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { randomId } from '@/components/sidebar/receiving/receiving-sidebar-shared';

type ReceiveIntent = 'zoho_receive' | 'scan_only';

/**
 * Last response from POST /api/receiving/mark-received-po. Surfaced in the UI
 * (ReceiveResponsePanel) so operators can see exactly why a Zoho receive
 * succeeded, was skipped (missing zoho ids), or failed (rate_limit,
 * circuit_open, api, other). No more silent failures.
 */
export type ReceiveResponseRecord = {
  at: number;
  /** ms wall-clock from POST → response */
  durationMs: number;
  httpStatus: number;
  ok: boolean;
  /** Raw JSON body returned from the API. */
  body: unknown;
  /** Network-level error message (thrown before/after the fetch). */
  networkError?: string;
};

/**
 * Sticky progress card shown in the bottom-right toast while the Receive →
 * Zoho roundtrip is in flight. Renders an indeterminate bar (CSS keyframes
 * live in globals.css under `.recv-indet-bar`) and an elapsed-seconds counter
 * so the operator knows the request is still alive even when Zoho is slow.
 */
function ReceiveProgressToast({ startedAt, intent }: { startedAt: number; intent: ReceiveIntent }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const label = intent === 'scan_only' ? 'Marking as scanned…' : 'Receiving in Zoho…';
  return (
    <div className="flex min-w-[260px] flex-col gap-2">
      <div className="flex items-center justify-between text-label font-semibold text-gray-900">
        <span>{label}</span>
        <span className="tabular-nums text-gray-500">{elapsed}s</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70">
        <div className="recv-indet-bar h-full w-1/3 rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

/**
 * The Receive / Mark-as-scanned action for a single line. Runs as a
 * fire-and-forget background task (the Zoho roundtrip can take many seconds) —
 * the button does NOT visually lock; progress is surfaced in a sticky
 * bottom-right toast and a ref guards against double-clicks. The last response
 * is exposed for the inline ReceiveResponsePanel.
 */
export function useReceiveAction(
  row: ReceivingLineRow,
  {
    qa,
    disp,
    cond,
    notes,
    zendesk,
    listingLink,
    serialInput,
    staffId,
  }: {
    qa: string;
    disp: string;
    cond: string;
    notes: string;
    zendesk: string;
    listingLink: string;
    serialInput: string;
    staffId: string;
  },
) {
  const receiveInFlightRef = useRef(false);
  const [lastReceiveResponse, setLastReceiveResponse] = useState<ReceiveResponseRecord | null>(null);
  const [responseExpanded, setResponseExpanded] = useState(false);

  const handleReceive = useCallback(
    (receiveIntent: ReceiveIntent = 'zoho_receive') => {
      if (receiveInFlightRef.current) return;
      if (row.receiving_id == null) {
        toast.error('Cannot receive — link this item to a shipment first.', {
          description: 'Scan tracking or use lookup so this line has a receiving (package) id.',
          duration: 6000,
        });
        return;
      }
      receiveInFlightRef.current = true;
      const startedAt = Date.now();
      // Stable per-click id used as both the Idempotency-Key header and the
      // body's client_event_id so api_idempotency_responses replays the
      // cached response on retry / double-click instead of re-running the
      // receive flow (which would double-call Zoho).
      const clientEventId = randomId();
      // Sticky progress toast (bottom-right via the global <Toaster>). Same
      // id is reused on settle so success/error replaces the loading card
      // in place instead of stacking another card on top.
      const toastId = toast.loading(
        <ReceiveProgressToast startedAt={startedAt} intent={receiveIntent} />,
        { duration: Infinity, closeButton: false },
      );

      // Fire-and-forget — operator keeps working while Zoho responds. The
      // print popup was opened synchronously by the caller (runPrintLabel)
      // before we got here, so no await blocks it.
      void (async () => {
        try {
          // Circuit-breaker pre-check: if Zoho is in cooldown, bail with a
          // specific "retry in Ns" message instead of firing the receive
          // (which would either skip Zoho silently or wait for the
          // background after() to fail). Only relevant for the zoho_receive
          // intent — scan_only doesn't touch Zoho. The check is best-effort
          // and never blocks the receive on its own failure.
          if (receiveIntent === 'zoho_receive') {
            try {
              const healthRes = await fetch('/api/zoho/health', {
                signal: AbortSignal.timeout(3_000),
              });
              const healthData = await healthRes.json().catch(() => null);
              const circuit = healthData?.zoho?.circuit as
                | { isOpen?: boolean; retryAfterMs?: number; consecutiveFailures?: number }
                | undefined;
              if (circuit?.isOpen) {
                const secs = Math.max(1, Math.ceil((circuit.retryAfterMs ?? 0) / 1000));
                toast.error(`Zoho cooldown — retry in ~${secs}s.`, {
                  id: toastId,
                  description: `Circuit breaker open after ${circuit.consecutiveFailures ?? 0} recent Zoho failures. The PO will NOT be marked received until Zoho recovers.`,
                  duration: 7000,
                });
                setLastReceiveResponse({
                  at: Date.now(),
                  durationMs: Date.now() - startedAt,
                  httpStatus: 0,
                  ok: false,
                  body: { skip_reason: 'zoho_circuit_open', circuit },
                });
                setResponseExpanded(true);
                return;
              }
            } catch {
              /* health check itself failed — fall through; the real
                 receive call below surfaces any genuine error */
            }
          }

          const perLineNotes = notes.trim() || null;

          const markRes = await fetch('/api/receiving/mark-received-po', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': clientEventId,
            },
            body: JSON.stringify({
              receiving_id: row.receiving_id,
              receiving_line_id: row.id,
              receive_intent: receiveIntent,
              qa_status: qa,
              disposition_code: disp,
              condition_grade: cond,
              serial_number: serialInput.trim() || undefined,
              zendesk_ticket: zendesk.trim() || undefined,
              listing_link: listingLink.trim() || undefined,
              notes: perLineNotes || undefined,
              staff_id: Number(staffId),
              client_event_id: clientEventId,
            }),
            // Hard ceiling so a server-side hang can never re-pin the
            // loading toast. The handler returns optimistically within a
            // few seconds; anything past 30s is a real failure and the
            // operator should retry — the same Idempotency-Key replays
            // the cached response if the server actually did complete.
            signal: AbortSignal.timeout(30_000),
          });
          const markData = await markRes.json().catch(() => null);

          const respRecord: ReceiveResponseRecord = {
            at: Date.now(),
            durationMs: Date.now() - startedAt,
            httpStatus: markRes.status,
            ok: markRes.ok && Boolean(markData?.success),
            body: markData,
          };
          setLastReceiveResponse(respRecord);

          if (!markRes.ok || !markData?.success) {
            console.error('receiving/mark-received-po failed', { status: markRes.status, error: markData?.error });
            toast.error(markData?.error || `Receive failed (HTTP ${markRes.status})`, {
              id: toastId,
              duration: 6000,
            });
            setResponseExpanded(true);
          } else {
            const zoho = markData?.zoho as
              | {
                  attempted?: number;
                  ok?: boolean;
                  pending?: boolean;
                  rate_limited?: boolean;
                  error?: string | null;
                  skip_reason?: string | null;
                  results?: Array<{ purchaseorder_id?: string; receive_id: string | null; error: string | null; error_kind?: string | null }>;
                }
              | undefined;
            if (zoho?.attempted) {
              // Optimistic flow: server already committed locally; Zoho sync
              // is running in the background. UI shows immediate success;
              // any Zoho-side failure surfaces via the receiving-logs
              // realtime channel and a follow-up refresh.
              if (zoho.pending) {
                toast.success('Marked as received — Zoho sync in progress', {
                  id: toastId,
                  duration: 4500,
                });
                setResponseExpanded(false);
              } else if (zoho.rate_limited) {
                toast.error('Zoho daily API quota exhausted — PO was NOT marked received in Zoho. Lines stay in Scanned until Zoho succeeds.', {
                  id: toastId,
                  description: 'Wait for the daily reset or reduce other Zoho-touching workflows for now.',
                  duration: 8000,
                });
                setResponseExpanded(true);
              } else if (!zoho.ok) {
                // Treat "already received in Zoho" as success — Zoho is ahead
                // of us, local SoT now matches.
                const alreadyReceived = /already\s+created\s+a\s+receive\s+for\s+all\s+the\s+items/i.test(
                  String(zoho.error || ''),
                );
                if (alreadyReceived) {
                  toast.success('Already marked as received in Zoho', {
                    id: toastId,
                    description: 'Local state now matches the Zoho dashboard.',
                    duration: 5000,
                  });
                  setResponseExpanded(false);
                } else {
                  toast.error(`Zoho receive failed: ${zoho.error || 'unknown error'}`, {
                    id: toastId,
                    duration: 6000,
                  });
                  setResponseExpanded(true);
                }
              } else if (zoho.skip_reason === 'zoho_already_fully_received') {
                toast.success('Zoho already shows this PO as fully received.', {
                  id: toastId,
                  description: 'Purchase receive was not needed; inventory matches the dashboard.',
                  duration: 5000,
                });
                setResponseExpanded(false);
              } else {
                toast.success(
                  <div className="flex flex-col gap-1 text-left">
                    <span className="leading-snug">Successfully added SN# & notes to PO item</span>
                    <span className="leading-snug">Successfully marked the PO as Received</span>
                  </div>,
                  { id: toastId, duration: 6000 },
                );
                setResponseExpanded(false);
              }
            } else {
              const skipReason = zoho?.skip_reason;
              if (skipReason === 'scan_only') {
                toast.success('Marked as scanned locally (Zoho not updated). Run Receive when ready to sync inventory.', {
                  id: toastId,
                  duration: 6500,
                });
                setResponseExpanded(false);
              } else if (skipReason === 'zoho_already_fully_received') {
                toast.success('Zoho already shows this PO as fully received.', {
                  id: toastId,
                  description: 'Purchase receive was not needed; inventory matches the dashboard.',
                  duration: 5000,
                });
                setResponseExpanded(false);
              } else if (skipReason === 'no_receiving_lines') {
                toast.message('No receiving lines on this shipment.', { id: toastId, duration: 5000 });
                setResponseExpanded(true);
              } else {
                toast.error('Lines saved locally — Zoho was NOT updated (no PO link found).', {
                  id: toastId,
                  description: 'Sync with Zoho first (refresh icon) to link this package to a PO.',
                  duration: 7000,
                });
                setResponseExpanded(true);
              }
            }
          }

          window.dispatchEvent(new CustomEvent('receiving-entry-added'));
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));

          // Fire-and-forget refresh AFTER the toast has settled. The
          // /api/receiving-lines query can run 10–30s under load and used
          // to be awaited inline, which pinned "Receiving in Zoho…" on
          // screen for the full statement_timeout window even when the
          // receive itself had already succeeded. The receiving-logs
          // realtime channel and the usav-refresh-data event above
          // reconcile the row independently if this refresh is slow.
          if (markRes.ok) {
            void (async () => {
              try {
                const linesRes = await fetch(
                  `/api/receiving-lines?receiving_id=${row.receiving_id}&include=serials`,
                  { signal: AbortSignal.timeout(15_000) },
                );
                const lineData = await linesRes.json();
                const rows = Array.isArray(lineData?.receiving_lines) ? lineData.receiving_lines : [];
                for (const r of rows) {
                  dispatchLineUpdated(r as ReceivingLineRow);
                }
              } catch { /* table may still reflect partial state — realtime channel reconciles */ }
            })();
          }
        } catch (err) {
          console.error('receiving/mark-received-po threw', err);
          const message = err instanceof Error ? err.message : 'Receive failed';
          toast.error(message, { id: toastId, duration: 6000 });
          setLastReceiveResponse({
            at: Date.now(),
            durationMs: Date.now() - startedAt,
            httpStatus: 0,
            ok: false,
            body: null,
            networkError: message,
          });
          setResponseExpanded(true);
        } finally {
          receiveInFlightRef.current = false;
        }
      })();
    },
    [row.receiving_id, row.id, qa, disp, cond, notes, zendesk, listingLink, serialInput, staffId],
  );

  return {
    lastReceiveResponse,
    setLastReceiveResponse,
    responseExpanded,
    setResponseExpanded,
    handleReceive,
  };
}
