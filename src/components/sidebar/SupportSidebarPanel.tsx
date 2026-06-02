'use client';

import Link from 'next/link';
import { sectionLabel, cardTitle, fieldLabel } from '@/design-system/tokens/typography/presets';

export function SupportSidebarPanel() {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className={`${sectionLabel} text-rose-600`}>Customer Support</p>
        <h3 className={`mt-2 ${cardTitle}`}>Operational queue</h3>
        <p className="mt-2 text-caption font-semibold leading-relaxed text-gray-600">
          Manage Zendesk support tickets directly here — read the conversation, reply or add an internal note, and set
          status, priority, and assignee without leaving the app.
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('support-refresh'))}
          className={`mt-4 inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 ${sectionLabel} text-white transition-colors hover:bg-black`}
        >
          Refresh Queue
        </button>
        <div className={`mt-4 space-y-2 ${fieldLabel}`}>
          <Link
            href="/admin?section=connections"
            className="block rounded-xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            Check Connections
          </Link>
          <Link
            href="/repair"
            className="block rounded-xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            Repair Tickets
          </Link>
        </div>
      </div>
    </div>
  );
}
