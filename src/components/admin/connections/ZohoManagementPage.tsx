'use client';

import { ZohoInboundStatusBanner } from '@/components/receiving/ZohoInboundStatusBanner';
import { ZohoSyncCard } from '@/components/admin/connections/ZohoSyncCard';

export function ZohoManagementPage() {
  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="border-b border-gray-200 px-6 py-5">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-500">Connections</p>
        <div className="mt-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Zoho Tools</h2>
          <p className="mt-1 text-[11px] font-bold leading-relaxed text-gray-500">
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
