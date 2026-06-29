'use client';

/**
 * Client islands for the billing page. The page itself is a server
 * component (loads org/sub from the DB); the upgrade and portal buttons
 * need to redirect to Stripe-hosted URLs which means making a POST and
 * following the response. That's a tiny client surface — kept separate
 * so the page stays SSR-friendly.
 */

import { useCallback, useState } from 'react';
import type { PlatformPlan } from '@/lib/tenancy/constants';
import { Button } from '@/design-system/primitives';

interface BillingActionsProps {
  hasStripeCustomer: boolean;
}

export function BillingActions({ hasStripeCustomer }: BillingActionsProps) {
  const [busy, setBusy] = useState(false);

  const openPortal = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await r.json();
      if (r.ok && data.url) {
        window.location.href = data.url as string;
      } else {
        alert(`Couldn't open billing portal: ${data.error || r.status}`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  if (!hasStripeCustomer) {
    return (
      <div className="text-label text-gray-500">
        No billing customer yet — upgrade a plan to set one up.
      </div>
    );
  }

  return (
    <Button variant="secondary" type="button" onClick={openPortal} disabled={busy}>
      {busy ? 'Opening…' : 'Manage billing'}
    </Button>
  );
}

interface UpgradeButtonProps { plan: PlatformPlan }

export function UpgradeButton({ plan }: UpgradeButtonProps) {
  const [busy, setBusy] = useState(false);
  const onClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await r.json();
      if (r.ok && data.url) {
        window.location.href = data.url as string;
      } else {
        alert(`Couldn't start checkout: ${data.error || r.status}`);
      }
    } finally {
      setBusy(false);
    }
  }, [plan]);

  return (
    <Button variant="brand" type="button" onClick={onClick} disabled={busy} className="w-full">
      {busy ? 'Redirecting…' : 'Upgrade'}
    </Button>
  );
}
