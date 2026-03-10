'use client';

import Link from 'next/link';

export function SupportSidebarPanel() {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-600">Customer Support</p>
        <h3 className="mt-2 text-lg font-black tracking-tight text-gray-900">Operational queue</h3>
        <p className="mt-2 text-[11px] font-medium leading-relaxed text-gray-600">
          This page centralizes eBay unread conversations, eBay return requests, and Zendesk open tickets so support
          work is triaged from one queue.
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('support-refresh'))}
          className="mt-4 inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-black"
        >
          Refresh Queue
        </button>
        <div className="mt-4 space-y-2 text-[10px] font-bold uppercase tracking-[0.18em]">
          <Link
            href="/admin?section=connections"
            className="block rounded-2xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            Check Connections
          </Link>
          <Link
            href="/repair"
            className="block rounded-2xl border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            Repair Tickets
          </Link>
        </div>
      </div>
    </div>
  );
}
