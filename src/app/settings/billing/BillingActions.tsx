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
      <div className="text-[12px] text-gray-500">
        No billing customer yet — upgrade a plan to set one up.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={openPortal}
      disabled={busy}
      className="inline-flex items-center rounded-2xl border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? 'Opening…' : 'Manage billing'}
    </button>
  );
}

interface UpgradeButtonProps { plan: PlatformPlan }

function UpgradeButton({ plan }: UpgradeButtonProps) {
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
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? 'Redirecting…' : 'Upgrade'}
    </button>
  );
}

BillingActions.UpgradeButton = UpgradeButton;
