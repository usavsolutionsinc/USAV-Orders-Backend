'use client';

import { ZohoInboundStatusBanner } from '@/components/receiving/ZohoInboundStatusBanner';
import { ZohoSyncCard } from '@/components/admin/connections/ZohoSyncCard';

export function ZohoManagementPage() {
  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-surface-card">
      <div className="border-b border-border-soft px-6 py-5">
        <p className="text-micro font-black uppercase tracking-[0.24em] text-text-soft">Connections</p>
        <div className="mt-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-text-default">Zoho Tools</h2>
          <p className="mt-1 text-caption font-bold leading-relaxed text-text-soft">
            Refresh the Zoho token, sync expected receiving lines, and import a single purchase receive from one place.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ZohoInboundStatusBanner />
        <div className="px-6 py-5">
          <ZohoSyncCard embedded />
        </div>
      </div>
    </section>
  );
}
