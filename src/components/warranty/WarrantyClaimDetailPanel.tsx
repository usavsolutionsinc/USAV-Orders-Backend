'use client';

import { motion } from 'framer-motion';
import { Loader2, Trash2, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useWarrantyClaim } from '@/hooks/useWarrantyClaims';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import { WarrantyClockChip, WarrantyStatusBadge } from '@/components/warranty/chips';
import { WarrantyClaimActions } from '@/components/warranty/WarrantyClaimActions';
import { WarrantyTicketButton } from '@/components/warranty/WarrantyTicketPopover';
import { WarrantyQuotesSection } from '@/components/warranty/WarrantyQuotesSection';
import { SourceThisButton } from '@/components/sourcing/SourceThisButton';
import { formatDateTimePST } from '@/utils/date';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import type { WarrantyClaimDetail } from '@/lib/warranty/types';

interface WarrantyClaimDetailPanelProps {
  claimId: number;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800">{value || <span className="text-gray-300">—</span>}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 px-5 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {children}
    </section>
  );
}

export function WarrantyClaimDetailPanel({ claimId, onClose }: WarrantyClaimDetailPanelProps) {
  const { data: claim, isLoading, error } = useWarrantyClaim(claimId);
  const { remove } = useWarrantyMutations();

  const deleteClaim = () => {
    if (!claim) return;
    const ok = window.confirm(
      `Delete claim ${claim.claimNumber}? It will disappear from all warranty views (the audit trail is kept).`,
    );
    if (!ok) return;
    remove.mutate({ id: claim.id }, { onSuccess: onClose });
  };

  return (
    <motion.div
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 420, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="flex h-full w-[420px] shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">
            {claim?.productTitle || claim?.sku || claim?.serialNumber || 'Warranty claim'}
          </div>
          <div className="font-mono text-[11px] text-gray-400">{claim?.claimNumber}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {claim && (claim.productTitle || claim.sku) && (
            <SourceThisButton searchQuery={claim.productTitle || claim.sku} label="Source" variant="ghost" />
          )}
          {claim && <WarrantyTicketButton claimId={claim.id} linked={claim.zendeskTicketId != null} />}
          {claim && (
            <button
              type="button"
              onClick={deleteClaim}
              disabled={remove.isPending}
              className="rounded-md p-1.5 text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              aria-label="Delete claim"
              title="Delete claim"
            >
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {remove.isError && (
        <p className="border-b border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-600">
          {remove.error instanceof Error ? remove.error.message : 'Delete failed.'}
        </p>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <div className="p-5 text-sm text-rose-600">
          {error instanceof Error ? error.message : 'Failed to load claim.'}
        </div>
      ) : !claim ? (
        <div className="p-5 text-sm text-gray-400">Claim not found.</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DetailBody claim={claim} />
          </div>
          <WarrantyClaimActions claim={claim} />
        </>
      )}
    </motion.div>
  );
}

function DetailBody({ claim }: { claim: WarrantyClaimDetail }) {
  return (
    <>
      <div className="flex items-center gap-2 px-5 py-4">
        <WarrantyStatusBadge status={claim.status} />
        <WarrantyClockChip daysRemaining={claim.daysRemaining} basis={claim.clockBasis} />
      </div>

      <Section title="Warranty clock">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Starts" value={claim.warrantyStartsAt ? formatDateTimePST(claim.warrantyStartsAt) : null} />
          <Field label="Expires" value={claim.warrantyExpiresAt ? formatDateTimePST(claim.warrantyExpiresAt) : null} />
          <Field label="Term" value={claim.warrantyDays ? `${claim.warrantyDays} days` : null} />
          <Field
            label="Basis"
            value={
              claim.clockBasis === 'DELIVERED'
                ? 'Carrier delivered'
                : claim.clockBasis === 'PACKED_PLUS_ESTIMATE'
                  ? 'Packed + estimate (provisional)'
                  : null
            }
          />
          <Field label="Delivered" value={claim.deliveredAt ? formatDateTimePST(claim.deliveredAt) : null} />
          <Field label="Packed/scanned" value={claim.packedScannedAt ? formatDateTimePST(claim.packedScannedAt) : null} />
        </dl>
      </Section>

      {(claim.rmaNumber || claim.repairTicket || claim.zendeskTicketId) && (
        <Section title="Linked">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="RMA" value={claim.rmaNumber} />
            <Field label="Repair ticket" value={claim.repairTicket} />
            <Field
              label="Zendesk"
              value={
                claim.zendeskTicketId != null && zendeskTicketUrl(claim.zendeskTicketId) ? (
                  <a
                    className="text-blue-600 underline"
                    href={zendeskTicketUrl(claim.zendeskTicketId) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    #{claim.zendeskTicketId}
                  </a>
                ) : null
              }
            />
          </dl>
        </Section>
      )}

      <Section title="Subject">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Serial" value={claim.serialNumber} />
          <Field label="SKU" value={claim.sku} />
          <Field label="Order" value={claim.orderId ?? claim.sourceOrderId} />
          <Field label="Source" value={claim.sourceSystem} />
          <Field label="Customer" value={claim.customerName} />
          <Field label="Tracking" value={claim.sourceTrackingNumber} />
        </dl>
      </Section>

      <Section title="Purchase proof">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Purchased" value={claim.purchasedAt ? formatDateTimePST(claim.purchasedAt) : null} />
          <Field
            label="Proof"
            value={
              claim.purchaseProofUrl ? (
                <a className="text-blue-600 underline" href={claim.purchaseProofUrl} target="_blank" rel="noreferrer">
                  View
                </a>
              ) : null
            }
          />
        </dl>
      </Section>

      {(claim.denialReasonCode || claim.denialNotes) && (
        <Section title="Denial">
          <dl className="grid grid-cols-1 gap-y-3">
            <Field label="Reason code" value={claim.denialReasonCode} />
            <Field label="Notes" value={claim.denialNotes} />
          </dl>
        </Section>
      )}

      <Section title={`Repair attempts (${claim.repairAttempts.length})`}>
        {claim.repairAttempts.length === 0 ? (
          <p className="text-sm text-gray-400">No repair attempts logged.</p>
        ) : (
          <ul className="space-y-3">
            {claim.repairAttempts.map((a) => (
              <li key={a.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Attempt #{a.attemptNo}</span>
                  {a.outcome && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{a.outcome}</span>
                  )}
                </div>
                {a.diagnosis && <p className="mt-1 text-sm text-gray-700">{a.diagnosis}</p>}
                {a.notes && <p className="mt-1 text-[12px] text-gray-500">{a.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {claim.quotes.length > 0 && (
        <Section title={`Paid-repair quotes (${claim.quotes.length})`}>
          <WarrantyQuotesSection claimId={claim.id} quotes={claim.quotes} />
        </Section>
      )}

      <Section title="Timeline">
        {claim.events.length === 0 ? (
          <p className="text-sm text-gray-400">No events yet.</p>
        ) : (
          <ul className="space-y-2">
            {claim.events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[12px]">
                <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300')} />
                <div>
                  <span className="font-medium text-gray-700">
                    {e.eventType}
                    {e.toStatus ? ` → ${e.toStatus}` : ''}
                  </span>
                  <span className="ml-2 text-gray-400">{formatDateTimePST(e.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {claim.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-gray-700">{claim.notes}</p>
        </Section>
      )}
    </>
  );
}
