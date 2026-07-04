'use client';

import { useState } from 'react';
import { AlertCircle, Clock, Loader2, ShieldCheck } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { Button } from '@/design-system/primitives';
import { useWarrantyCoverage, useWarrantyUrlState } from '@/hooks/useWarrantyClaims';
import { WarrantyLogClaimDialog } from '@/components/warranty/WarrantyLogClaimDialog';
import { WARRANTY_STATUS_LABEL } from '@/lib/warranty/types';
import { formatDateTimePST } from '@/utils/date';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/**
 * Read-only warranty-coverage banner for the "on the phone with a customer"
 * flow: the rep types/scans an order #, serial, or SKU into the sidebar search
 * and this card — the prominent first result above the claims table — answers
 * "is this still under warranty?" with a days-left clock, then offers Log Claim.
 */
export function WarrantyCoverageCard({ query }: { query: string }) {
  const q = query.trim();
  const { data, isLoading, isFetching } = useWarrantyCoverage(q);
  const { openClaim } = useWarrantyUrlState();
  const [logOpen, setLogOpen] = useState(false);

  // Below the lookup threshold → nothing to show (the table handles filtering).
  if (q.length < 3) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-b border-border-hairline bg-surface-card px-4 py-3 text-sm text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        Checking warranty coverage for “{q}”…
      </div>
    );
  }

  if (!data || !data.found) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border-hairline bg-surface-card px-4 py-3">
        <p className="text-sm text-text-soft">
          No shipped order matches “<span className="font-medium text-text-muted">{q}</span>”.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLogOpen(true)}
          className="shrink-0 text-xs"
        >
          Log claim manually
        </Button>
        <WarrantyLogClaimDialog open={logOpen} onClose={() => setLogOpen(false)} onCreated={(id) => openClaim(id)} />
      </div>
    );
  }

  const provisional = data.clockBasis === 'PACKED_PLUS_ESTIMATE';
  const status =
    data.inWarranty === true ? 'covered' : data.inWarranty === false ? 'expired' : 'unknown';

  const tone =
    status === 'covered'
      ? { ring: 'ring-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', icon: ShieldCheck }
      : status === 'expired'
        ? { ring: 'ring-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', icon: AlertCircle }
        : { ring: 'ring-amber-200', bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock };
  const Icon = tone.icon;

  const headline =
    status === 'covered' ? 'In warranty' : status === 'expired' ? 'Out of warranty' : 'Coverage unknown';
  const sub =
    status === 'covered'
      ? data.daysRemaining === 0
        ? 'Last day of coverage'
        : `${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'} left`
      : status === 'expired'
        ? `Expired ${Math.abs(data.daysRemaining ?? 0)} day${Math.abs(data.daysRemaining ?? 0) === 1 ? '' : 's'} ago`
        : 'No delivery date on file yet';

  const title = data.productTitle || data.sku || data.serialNumber || data.sourceOrderId || 'Shipped order';

  return (
    <div className={cn('border-b', tone.ring, 'border-border-hairline bg-surface-card')}>
      <div className={cn('m-3 rounded-xl ring-1 ring-inset p-4', tone.ring, tone.bg)}>
        <div className="flex items-start gap-3">
          <span className={cn('mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-card ring-1 ring-inset', tone.ring, tone.text)}>
            <Icon className="h-5 w-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-semibold', tone.text)}>{headline}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums ring-1 ring-inset', tone.ring, tone.text, 'bg-surface-card')}>
                {sub}
              </span>
              {provisional && (
                <HoverTooltip
                  label="Provisional — based on packed date + delivery estimate; confirms when the carrier delivered date lands."
                  asChild
                >
                  <span className="rounded border border-dashed border-amber-300 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-amber-700">
                    Est.
                  </span>
                </HoverTooltip>
              )}
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />}
            </div>

            <p className="mt-1 truncate text-[15px] font-medium text-text-default">{title}</p>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-label sm:grid-cols-3">
              <Fact label="Order #" value={data.sourceOrderId} mono />
              <Fact label="Customer" value={data.customerName} />
              <Fact label={provisional ? 'Est. delivered' : 'Delivered'} value={fmt(data.deliveredAt ?? data.warrantyStartsAt)} />
              <Fact label="Expires" value={fmt(data.warrantyExpiresAt)} />
              <Fact label="Term" value={data.warrantyDays ? `${data.warrantyDays} days` : null} />
              <Fact label={data.serialNumber ? 'Serial' : 'SKU'} value={data.serialNumber || data.sku} mono />
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {data.existingClaim ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => openClaim(data.existingClaim!.id)}
                    className="text-xs"
                  >
                    View claim {data.existingClaim.claimNumber}
                  </Button>
                  <span className="text-caption text-text-faint">
                    Already logged · {WARRANTY_STATUS_LABEL[data.existingClaim.status]}
                  </span>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setLogOpen(true)}
                  className="text-xs"
                >
                  + Log claim
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <WarrantyLogClaimDialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onCreated={(id) => openClaim(id)}
        initial={{
          orderId: data.orderId,
          serialNumber: data.serialNumber,
          sku: data.sku,
          productTitle: data.productTitle,
        }}
      />
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro font-medium uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className={cn('truncate text-text-muted', mono && 'font-mono text-caption')}>
        {value || <span className="text-text-faint">—</span>}
      </dd>
    </div>
  );
}

function fmt(value: string | null | undefined): string | null {
  if (!value) return null;
  return formatDateTimePST(value);
}
