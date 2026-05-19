'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { Loader2, X } from '@/components/Icons';
import {
  CLAIM_TYPE_OPTIONS,
  CLAIM_SEVERITY_OPTIONS,
  type ClaimType,
  type ClaimSeverity,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
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
 * wraps the existing GAS bridge that creates Zendesk tickets via email.
 *
 * On success, the ticket # is handed to `onTicketCreated`, which the parent
 * uses to auto-fill the existing `zendesk` field in the Support FlowSection.
 * Operator can still manually paste a # via the existing affordance if the
 * bridge fails or returns no number.
 */
export function ReceivingClaimModal({ open, row, onClose, onTicketCreated }: Props) {
  const [claimType, setClaimType] = useState<ClaimType>('damage');
  const [severity, setSeverity] = useState<ClaimSeverity>('medium');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);

  const submit = async () => {
    if (submitting || !row.receiving_id) return;
    setSubmitting(true);
    setDraftBody(null);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          severity,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // Surface the fallback body so the operator can copy + paste into
        // Zendesk manually, then paste the # back via the Support field.
        setDraftBody(data?.draftBody ?? null);
        toast.error(data?.error || 'Could not file the claim');
        return;
      }
      toast.success(`Claim ${data.ticketNumber} created`);
      onTicketCreated(String(data.ticketNumber));
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
          {/* Full-viewport dim — covers the page sidebar too. */}
          <motion.div
            key="claim-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[118] bg-gray-900/50 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Dialog layer — absolute inset-0 anchors to the workspace
              overlay (which fills the right-pane), so the dialog centers
              over the receiving content, not the viewport. The container
              passes clicks through; the dialog itself stops them. */}
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
            className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-700">
                  File a claim
                </p>
                <p className="mt-0.5 text-[15px] font-extrabold tracking-tight text-gray-900">
                  Receiving #{row.receiving_id}
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
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                  Claim type
                </p>
                <div role="radiogroup" aria-label="Claim type" className="flex flex-wrap gap-1.5">
                  {CLAIM_TYPE_OPTIONS.map((opt) => {
                    const isActive = claimType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setClaimType(opt.value)}
                        className={`inline-flex h-9 items-center rounded-lg px-3 text-[11px] font-black uppercase tracking-wider transition-all ${
                          isActive ? opt.active : `${opt.inactive} hover:opacity-80`
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                  Severity
                </p>
                <div role="radiogroup" aria-label="Severity" className="flex gap-1.5">
                  {CLAIM_SEVERITY_OPTIONS.map((opt) => {
                    const isActive = severity === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setSeverity(opt.value)}
                        className={`inline-flex h-9 flex-1 items-center justify-center rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${
                          isActive ? opt.active : `${opt.inactive} hover:opacity-80`
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="claim-reason"
                  className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500"
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
                        ? '2 of 3 units missing from carton…'
                        : claimType === 'wrong_item'
                          ? 'Received model XL2 instead of MX5…'
                          : 'Inconsistent QA, multiple units DOA…'
                  }
                  className="block w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              <p className="text-[10px] font-semibold leading-snug text-gray-500">
                Photos already uploaded to this carton will be linked in the ticket body.
                A ticket # will be filed back into the Support section automatically.
              </p>

              {draftBody ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                    Bridge unreachable — copy this body to Zendesk
                  </p>
                  <textarea
                    readOnly
                    value={draftBody}
                    rows={6}
                    className="mt-1.5 block w-full resize-none rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-[10px] text-gray-800 outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(draftBody).then(() => {
                        toast.success('Body copied to clipboard');
                      });
                    }}
                    className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-700 hover:text-amber-900"
                  >
                    Copy to clipboard
                  </button>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-[11px] font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !row.receiving_id}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
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
