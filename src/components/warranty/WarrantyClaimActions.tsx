'use client';

import { useState } from 'react';
import { Button } from '@/design-system/primitives';
import { useWarrantyDenialReasons, useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import type { WarrantyClaimDetail } from '@/lib/warranty/types';

const REPAIR_OUTCOMES = ['FIXED', 'NOT_FIXABLE', 'PENDING_PARTS', 'RTV'] as const;

/**
 * Status-aware write actions for a warranty claim: lifecycle transitions, a deny
 * form (reason picker), and a repair-attempt form. Mutations invalidate the
 * list + detail caches on success.
 */
export function WarrantyClaimActions({ claim }: { claim: WarrantyClaimDetail }) {
  const { lifecycle, deny, logRepair, issueRma, repairHandoff, createQuote, ebayDraft } = useWarrantyMutations();
  const { data: denialReasons = [] } = useWarrantyDenialReasons();

  const [mode, setMode] = useState<null | 'deny' | 'repair' | 'quote' | 'ebay'>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [denialNotes, setDenialNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [outcome, setOutcome] = useState<(typeof REPAIR_OUTCOMES)[number] | ''>('');
  const [repairNotes, setRepairNotes] = useState('');
  const [quoteLabel, setQuoteLabel] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');

  const busy =
    lifecycle.isPending || deny.isPending || logRepair.isPending || issueRma.isPending ||
    repairHandoff.isPending || createQuote.isPending || ebayDraft.isPending;
  const error =
    lifecycle.error || deny.error || logRepair.error || issueRma.error || repairHandoff.error ||
    createQuote.error || ebayDraft.error;

  const reset = () => {
    setMode(null);
    setReasonCode('');
    setDenialNotes('');
    setDiagnosis('');
    setOutcome('');
    setRepairNotes('');
    setQuoteLabel('');
    setQuoteAmount('');
  };

  const draft = ebayDraft.data?.draft as
    | { title: string; description: string; conditionId: string; photoAttachmentIds: string[]; warning?: string }
    | undefined;

  const status = claim.status;
  const canSubmit = status === 'LOGGED';
  const canReview = status === 'SUBMITTED';
  const canRepair = status === 'APPROVED' || status === 'IN_REPAIR';
  const canClose = ['APPROVED', 'DENIED', 'REPAIRED', 'EXPIRED'].includes(status);
  const canIssueRma = (status === 'APPROVED' || status === 'IN_REPAIR') && !claim.rmaId;
  const canHandoffRepair = status === 'APPROVED' && !claim.repairServiceId;
  const canQuote = status === 'DENIED' || status === 'EXPIRED';
  const canEbay = status === 'REPAIRED' || status === 'CLOSED';

  return (
    <div className="border-t border-border-hairline bg-surface-canvas/60 px-5 py-4">
      {error && (
        <p className="mb-2 text-xs text-text-danger">
          {error instanceof Error ? error.message : 'Action failed.'}
        </p>
      )}

      {mode === 'deny' ? (
        <div className="space-y-2">
          <label className="block text-caption font-medium uppercase tracking-wide text-text-faint">Denial reason</label>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          >
            <option value="">Select a reason…</option>
            {denialReasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            value={denialNotes}
            onChange={(e) => setDenialNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="button"
              disabled={busy || !reasonCode}
              onClick={() =>
                deny.mutate(
                  { id: claim.id, reasonCode, denialNotes: denialNotes || undefined },
                  { onSuccess: reset },
                )
              }
            >
              Confirm denial
            </Button>
          </div>
        </div>
      ) : mode === 'repair' ? (
        <div className="space-y-2">
          <label className="block text-caption font-medium uppercase tracking-wide text-text-faint">Repair attempt</label>
          <textarea
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Diagnosis"
            rows={2}
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          />
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as (typeof REPAIR_OUTCOMES)[number] | '')}
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          >
            <option value="">Outcome (optional — leave blank for in-progress)</option>
            {REPAIR_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <textarea
            value={repairNotes}
            onChange={(e) => setRepairNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() =>
                logRepair.mutate(
                  {
                    id: claim.id,
                    diagnosis: diagnosis || undefined,
                    outcome: outcome || undefined,
                    notes: repairNotes || undefined,
                  },
                  { onSuccess: reset },
                )
              }
            >
              Log attempt
            </Button>
          </div>
        </div>
      ) : mode === 'quote' ? (
        <div className="space-y-2">
          <label className="block text-caption font-medium uppercase tracking-wide text-text-faint">Paid-repair quote</label>
          <input
            value={quoteLabel}
            onChange={(e) => setQuoteLabel(e.target.value)}
            placeholder="Line item (e.g. Bench repair + parts)"
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          />
          <input
            value={quoteAmount}
            onChange={(e) => setQuoteAmount(e.target.value)}
            placeholder="Amount (USD)"
            inputMode="decimal"
            className="w-full rounded-md border border-border-soft px-2 py-1.5 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={busy || !quoteLabel.trim() || !(Number(quoteAmount) > 0)}
              onClick={() =>
                createQuote.mutate(
                  {
                    id: claim.id,
                    lineItems: [{ label: quoteLabel.trim(), qty: 1, unitPrice: Number(quoteAmount) }],
                  },
                  { onSuccess: reset },
                )
              }
            >
              Create quote
            </Button>
          </div>
        </div>
      ) : mode === 'ebay' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-caption font-medium uppercase tracking-wide text-text-faint">eBay refurb draft</label>
            <Button variant="secondary" size="sm" type="button" onClick={reset}>Close</Button>
          </div>
          {ebayDraft.isPending ? (
            <p className="text-sm text-text-faint">Generating…</p>
          ) : draft ? (
            <div className="space-y-1">
              {draft.warning && <p className="text-caption text-text-warning">{draft.warning}</p>}
              <p className="text-sm font-medium text-text-default">{draft.title}</p>
              <p className="text-caption text-text-soft">Condition {draft.conditionId} · {draft.photoAttachmentIds.length} photo(s)</p>
              <textarea
                readOnly
                value={draft.description}
                rows={5}
                className="w-full rounded-md border border-border-soft bg-surface-canvas px-2 py-1.5 text-label"
              />
            </div>
          ) : (
            <p className="text-sm text-text-danger">No draft.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => lifecycle.mutate({ id: claim.id, action: 'submit' })}
            >
              Submit
            </Button>
          )}
          {canReview && (
            <>
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => lifecycle.mutate({ id: claim.id, action: 'approve' })}
              >
                Approve
              </Button>
              <Button variant="danger" size="sm" type="button" disabled={busy} onClick={() => setMode('deny')}>
                Deny
              </Button>
            </>
          )}
          {canRepair && (
            <Button variant="primary" size="sm" type="button" disabled={busy} onClick={() => setMode('repair')}>
              Log repair
            </Button>
          )}
          {canHandoffRepair && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => repairHandoff.mutate({ id: claim.id, issue: claim.productTitle || undefined })}
            >
              Send to repair
            </Button>
          )}
          {canIssueRma && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => issueRma.mutate({ id: claim.id })}
            >
              Issue RMA
            </Button>
          )}
          {canQuote && (
            <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => setMode('quote')}>
              Quote paid repair
            </Button>
          )}
          {canEbay && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('ebay');
                ebayDraft.mutate({ id: claim.id });
              }}
            >
              eBay refurb draft
            </Button>
          )}
          {canClose && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => lifecycle.mutate({ id: claim.id, action: 'close' })}
            >
              Close
            </Button>
          )}
          {status === 'CLOSED' && !canEbay && <span className="text-xs text-text-faint">Claim closed.</span>}
        </div>
      )}
    </div>
  );
}
