'use client';

import { Link2 } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

export function ConnectionsCard() {
  // The Connections tab itself orchestrates many providers (Zoho, eBay, USPS, FedEx, …).
  // There's no aggregated status endpoint today, so this card is intentionally
  // a "hand-off" — it links into the full Connections tab where individual
  // provider status lives. When an aggregate endpoint exists, swap in here.
  return (
    <StatusCard
      icon={Link2}
      title="Sync tools"
      primary="—"
      secondary="Run syncs · Zoho tools · activity"
      tertiary="Credential connect lives in Settings → Integrations"
      href="/admin?section=connections"
    />
  );
}
