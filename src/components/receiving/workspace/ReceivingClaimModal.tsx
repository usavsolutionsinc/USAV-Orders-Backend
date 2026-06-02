'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { Loader2, X } from '@/components/Icons';
import {
  CLAIM_TYPE_OPTIONS,
  CLAIM_SEVERITY_OPTIONS,
  type ClaimType,
  type ClaimSeverity,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface Props {
  open: boolean;
  row: ReceivingLineRow;
  onClose: () => void;
  /** Called with the formatted ticket number on success ("#12345"). */
  onTicketCreated: (ticketNumber: string) => void;
}

/**
 * Make-a-claim modal. Filed against the current receiving carton (and
 * optionally the active line). Posts to /api/receiving/zendesk-claim which
 * creates the ticket directly via the Zendesk REST API.
 *
 * On success, the ticket # is handed to `onTicketCreated`, which the parent
 * uses to auto-fill the existing `zendesk` field in the Support FlowSection.
 * Operator can still manually paste a # via the existing affordance if the
 * bridge fails or returns no number.
 */
export function ReceivingClaimModal({ open, row, onClose, onTicketCreated }: Props) {
  // Auto-select 'unfound' when the carton has no Zoho match — support's
  // routing for unmatched-tracking claims is different from damage/missing.
  const initialClaimType: ClaimType =
    row.receiving_source === 'unmatched' ? 'unfound' : 'damage';
  const [claimType, setClaimType] = useState<ClaimType>(initialClaimType);
  const [severity, setSeverity] = useState<ClaimSeverity>('medium');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);

  // Editable ticket template — populated from the server preview endpoint so
  // it reflects exactly what the ticket will contain (PO #, tracking,
  // photo URLs, line summary). The operator can edit either field before
  // posting; once they touch it we stop overwriting from the preview.
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const subjectTouched = useRef(false);
  const descriptionTouched = useRef(false);
  // Stable per-submission idempotency key — generated when the modal opens and
  // reused across retries so a failed-then-retried submit never files two tickets.
  const idempotencyKey = useRef('');

  // Reset transient state each time the modal opens so reopening on a
  // different row doesn't show stale template text.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setDraftBody(null);
    setSubject('');
    setDescription('');
    setClaimType(
      row.receiving_source === 'unmatched' ? 'unfound' : 'damage',
    );
    subjectTouched.current = false;
    descriptionTouched.current = false;
    idempotencyKey.current = crypto.randomUUID();
  }, [open, row.receiving_id, row.id, row.receiving_source]);

  // Fetch the server-rendered template whenever inputs change. Debounced so
  // typing in "reason" doesn't hammer the endpoint.
  useEffect(() => {
    if (!open || !row.receiving_id) return;
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setPreviewLoading(true);
      fetch('/api/receiving/zendesk-claim/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          severity,
          reason: reason.trim(),
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => {
          if (!data?.success) return;
          if (!subjectTouched.current && typeof data.subject === 'string') {
            setSubject(data.subject);
          }
          if (!descriptionTouched.current && typeof data.description === 'string') {
            setDescription(data.description);
          }
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            // Preview is best-effort — operator can still type their own.
          }
        })
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [open, row.receiving_id, row.id, claimType, severity, reason]);

  const claimTypeItems = useMemo<HorizontalSliderItem[]>(
    () => CLAIM_TYPE_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label })),
    [],
  );
  const severityItems = useMemo<HorizontalSliderItem[]>(
    () => CLAIM_SEVERITY_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label })),
    [],
  );

  const submit = async () => {
    if (submitting || !row.receiving_id) return;
    setSubmitting(true);
    setDraftBody(null);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
        },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          severity,
          reason: reason.trim(),
          subject: subject.trim(),
          description: description.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setDraftBody(data?.draftBody ?? null);
        toast.error(data?.error || 'Could not file the claim');
        return;
      }
      if (data.ticketNumber) {
        const url = typeof data.ticketUrl === 'string' ? data.ticketUrl : null;
        toast.success(`Claim ${data.ticketNumber} created`, {
          action: url
            ? { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') }
            : undefined,
        });
        onTicketCreated(String(data.ticketNumber));
      } else {
        toast.success('Claim filed — paste the Zendesk # back when assigned');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="claim-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[118] bg-gray-900/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="claim-dialog"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-0 z-[120] flex items-center justify-center p-4"
          >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4">
              <div>
                <p className="text-micro font-black uppercase tracking-[0.14em] text-rose-700">
                  File a claim
                </p>
                <p className="mt-0.5 text-base font-extrabold tracking-tight text-gray-900">
                  {row.receiving_source === 'unmatched'
                    ? 'Unfound'
                    : row.zoho_purchaseorder_number
                      ? `PO ${row.zoho_purchaseorder_number}`
                      : `Receiving #${row.receiving_id ?? '—'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                aria-label="Cancel"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <p className="mb-1.5 text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                  Claim type
                </p>
                <HorizontalButtonSlider
                  items={claimTypeItems}
                  value={claimType}
                  onChange={(id) => setClaimType(id as ClaimType)}
                  variant="nav"
                  size="md"
                  aria-label="Claim type"
                />
              </div>

              <div>
                <p className="mb-1.5 text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                  Severity
                </p>
                <HorizontalButtonSlider
                  items={severityItems}
                  value={severity}
                  onChange={(id) => setSeverity(id as ClaimSeverity)}
                  variant="nav"
                  size="md"
                  aria-label="Severity"
                />
              </div>

              <div>
                <label
                  htmlFor="claim-reason"
                  className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-gray-500"
                >
                  What happened?
                </label>
                <textarea
                  id="claim-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    claimType === 'damage'
                      ? 'Crushed packaging, dent on side panel…'
                      : claimType === 'missing'
                        ? '2 of 3 units missing from package…'
                        : claimType === 'wrong_item'
                          ? 'Received model XL2 instead of MX5…'
                          : 'Inconsistent QA, multiple units DOA…'
                  }
                  className="block w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-medium leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                    Ticket preview {previewLoading ? '(updating…)' : '(editable)'}
                  </p>
                  {(subjectTouched.current || descriptionTouched.current) ? (
                    <button
                      type="button"
                      onClick={() => {
                        subjectTouched.current = false;
                        descriptionTouched.current = false;
                        // Nudge the preview effect to re-run with current inputs.
                        setReason((r) => r);
                      }}
                      className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    >
                      Reset to template
                    </button>
                  ) : null}
                </div>

                <label
                  htmlFor="claim-subject"
                  className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
                >
                  Subject
                </label>
                <input
                  id="claim-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    subjectTouched.current = true;
                    setSubject(e.target.value);
                  }}
                  placeholder={previewLoading ? 'Generating…' : 'Subject'}
                  className="mb-3 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-semibold text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />

                <label
                  htmlFor="claim-body"
                  className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
                >
                  Body
                </label>
                <textarea
                  id="claim-body"
                  value={description}
                  onChange={(e) => {
                    descriptionTouched.current = true;
                    setDescription(e.target.value);
                  }}
                  rows={10}
                  placeholder={previewLoading ? 'Generating…' : 'Ticket body'}
                  className="block w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-caption leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              <p className="text-micro font-semibold leading-snug text-gray-500">
                The template auto-fills from PO, tracking, photos, and the active line. Edit either
                field above before posting. A ticket # will be filed back into the Support section
                automatically.
              </p>

              {draftBody ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-micro font-black uppercase tracking-widest text-amber-700">
                    Bridge unreachable — copy this body to Zendesk
                  </p>
                  <textarea
                    readOnly
                    value={draftBody}
                    rows={6}
                    className="mt-1.5 block w-full resize-none rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-micro text-gray-800 outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(draftBody).then(() => {
                        toast.success('Body copied to clipboard');
                      });
                    }}
                    className="mt-1.5 text-micro font-bold uppercase tracking-widest text-amber-700 hover:text-amber-900"
                  >
                    Copy to clipboard
                  </button>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !row.receiving_id || !subject.trim() || !description.trim()}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? 'Creating…' : 'Create Zendesk ticket'}
              </button>
            </div>
          </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
