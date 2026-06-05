'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PoMailboxTab } from '@/components/admin/PoMailboxTab';
import { UnfoundQueueSidebarToolbar } from '@/components/receiving/unfound/UnfoundQueueSidebarToolbar';
import { UnfoundQueueTable } from '@/components/receiving/unfound/UnfoundQueueTable';

/**
 * PO Mailbox admin section — the standalone home for the email-PO / unmatched
 * triage queue, relocated out of the removed receiving "Unfound" mode.
 *
 * Two sub-views:
 *   • Queue      — the triage surface (toolbar + table → /api/receiving/unfound-queue).
 *                  Sources: PO mailbox (emails not in Zoho), unmatched receiving,
 *                  exceptions, plus the Checked pile. The same engine the Unfound
 *                  mode rendered; only its home changed.
 *   • Connection — connect/disconnect the dedicated Gmail account (the existing
 *                  PoMailboxTab, previously orphaned: the OAuth callback redirects
 *                  to ?section=po_mailbox, which now resolves here).
 *
 * Defaults to Connection on an OAuth return so its ?po_gmail_connected flash
 * toast fires; otherwise defaults to the operational Queue.
 */
function PoMailboxAdminSectionInner() {
  const search = useSearchParams();
  const oauthReturn = !!(search.get('po_gmail_connected') || search.get('po_gmail_error'));
  const [view, setView] = useState<'queue' | 'connection'>(oauthReturn ? 'connection' : 'queue');

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2">
        <SubTab active={view === 'queue'} onClick={() => setView('queue')}>Queue</SubTab>
        <SubTab active={view === 'connection'} onClick={() => setView('connection')}>Connection</SubTab>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'queue' ? (
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden md:flex-row">
            <aside className="shrink-0 overflow-y-auto border-b border-gray-200 bg-white md:w-72 md:border-b-0 md:border-r">
              <UnfoundQueueSidebarToolbar />
            </aside>
            <div className="min-h-0 flex-1 overflow-hidden">
              <UnfoundQueueTable />
            </div>
          </div>
        ) : (
          <PoMailboxTab />
        )}
      </div>
    </div>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
        active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

export function PoMailboxAdminSection() {
  return (
    <Suspense fallback={null}>
      <PoMailboxAdminSectionInner />
    </Suspense>
  );
}
