'use client';

import { motion } from 'framer-motion';
import { Loader2, Trash2, X } from '@/components/Icons';
import { useWarrantyClaim } from '@/hooks/useWarrantyClaims';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import { WarrantyClockChip, WarrantyStatusBadge } from '@/components/warranty/chips';
import { WarrantyClaimActions } from '@/components/warranty/WarrantyClaimActions';
import { WarrantyTicketButton } from '@/components/warranty/WarrantyTicketPopover';
import { WarrantyQuotesSection } from '@/components/warranty/WarrantyQuotesSection';
import { SourceThisButton } from '@/components/sourcing/SourceThisButton';
import { EventTimeline } from '@/components/ui/EventTimeline';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { warrantyEventsToTimeline } from '@/lib/timeline';
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
      <dt className="text-caption font-medium uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-default">{value || <span className="text-text-faint">—</span>}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-hairline px-5 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-faint">{title}</h3>
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
      className="flex h-full w-[420px] shrink-0 flex-col border-l border-border-soft bg-surface-card shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-default">
            {claim?.productTitle || claim?.sku || claim?.serialNumber || 'Warranty claim'}
          </div>
          <div className="font-mono text-caption text-text-faint">{claim?.claimNumber}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {claim && (claim.productTitle || claim.sku) && (
            <SourceThisButton searchQuery={claim.productTitle || claim.sku} label="Source" variant="ghost" />
          )}
          {claim && <WarrantyTicketButton claimId={claim.id} linked={claim.zendeskTicketId != null} />}
          {claim && (
            <HoverTooltip label="Delete claim" asChild>
              <IconButton
                onClick={deleteClaim}
                disabled={remove.isPending}
                ariaLabel="Delete claim"
                className="rounded-md p-1.5 text-text-faint transition hover:bg-surface-danger hover:text-text-danger disabled:opacity-50"
                icon={remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              />
            </HoverTooltip>
          )}
          <IconButton
            onClick={onClose}
            ariaLabel="Close"
            className="rounded-full p-1.5 text-text-faint transition hover:bg-surface-sunken hover:text-text-muted"
            icon={<X className="h-4 w-4" />}
          />
        </div>
      </header>

      {remove.isError && (
        <p className="border-b border-border-danger bg-surface-danger px-5 py-2 text-xs text-text-danger">
          {remove.error instanceof Error ? remove.error.message : 'Delete failed.'}
        </p>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-text-faint" />
        </div>
      ) : error ? (
        <div className="p-5 text-sm text-text-danger">
          {error instanceof Error ? error.message : 'Failed to load claim.'}
        </div>
      ) : !claim ? (
        <div className="p-5 text-sm text-text-faint">Claim not found.</div>
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
                    className="text-text-accent underline"
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
                <a className="text-text-accent underline" href={claim.purchaseProofUrl} target="_blank" rel="noreferrer">
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
          <p className="text-sm text-text-faint">No repair attempts logged.</p>
        ) : (
          <ul className="space-y-3">
            {claim.repairAttempts.map((a) => (
              <li key={a.id} className="rounded-lg border border-border-hairline p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-muted">Attempt #{a.attemptNo}</span>
                  {a.outcome && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-caption text-text-muted">{a.outcome}</span>
                  )}
                </div>
                {a.diagnosis && <p className="mt-1 text-sm text-text-muted">{a.diagnosis}</p>}
                {a.notes && <p className="mt-1 text-label text-text-soft">{a.notes}</p>}
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
        <EventTimeline
          items={warrantyEventsToTimeline(claim.events)}
          density="compact"
          highlightLatest={false}
          emptyMessage="No events yet."
        />
      </Section>

      {claim.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-text-muted">{claim.notes}</p>
        </Section>
      )}
    </>
  );
}
