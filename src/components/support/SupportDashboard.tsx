'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ExternalLink, RefreshCw } from '@/components/Icons';

interface QueueItem {
  [key: string]: any;
}

interface ChannelSummary {
  count: number;
  items: QueueItem[];
  error: string | null;
  healthy: boolean;
}

interface EbayAccountSummary {
  accountName: string;
  unreadMessages: ChannelSummary;
  returnRequests: ChannelSummary;
}

interface ZendeskSummary {
  configured: boolean;
  healthy: boolean;
  count: number;
  urgentCount: number;
  tickets: QueueItem[];
  agentUrl: string | null;
  error: string | null;
}

interface SupportOverviewResponse {
  success: boolean;
  generatedAt: string;
  totals: {
    unreadMessages: number;
    returnRequests: number;
    zendeskTickets: number;
    attentionItems: number;
  };
  ebayAccounts: EbayAccountSummary[];
  zendesk: ZendeskSummary;
}

function formatDateTime(value: string) {
  if (!value) return 'Just now';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'amber' | 'emerald' | 'rose';
}) {
  const toneClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
  };

  return (
    <div className={`rounded-3xl border p-4 ${toneClasses[tone]}`}>
      <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-80">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

export function SupportDashboard() {
  const query = useQuery<SupportOverviewResponse>({
    queryKey: ['support-overview'],
    queryFn: async () => {
      const response = await fetch('/api/support/overview', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load support overview (HTTP ${response.status})`);
      }

      return data;
    },
    refetchInterval: 60000,
  });

  useEffect(() => {
    const handleRefresh = () => {
      void query.refetch();
    };

    window.addEventListener('support-refresh', handleRefresh as EventListener);
    return () => {
      window.removeEventListener('support-refresh', handleRefresh as EventListener);
    };
  }, [query]);

  if (query.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md rounded-3xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-black uppercase tracking-[0.2em] text-gray-900">Support data unavailable</p>
          <p className="mt-2 text-sm text-gray-600">{query.error instanceof Error ? query.error.message : 'Unknown error'}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { totals, ebayAccounts, zendesk, generatedAt } = query.data;

  return (
    <div className="min-h-full bg-gray-50 p-4">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-600">Customer Support</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-900">Unified support queue</h1>
              <p className="mt-2 text-sm text-gray-600">
                One view for eBay unread messages, active eBay returns, and Zendesk open tickets.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
                Updated {formatDateTime(generatedAt)}
              </div>
              <button
                type="button"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
                className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard label="Unread Messages" value={totals.unreadMessages} tone="blue" />
          <SummaryCard label="Return Requests" value={totals.returnRequests} tone="amber" />
          <SummaryCard label="Zendesk Open" value={totals.zendeskTickets} tone="emerald" />
          <SummaryCard label="Connection Alerts" value={totals.attentionItems} tone="rose" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="space-y-4">
            {ebayAccounts.map((account) => (
              <div key={account.accountName} className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-500">eBay account</p>
                    <h2 className="text-lg font-black tracking-tight text-gray-900">{account.accountName}</h2>
                  </div>
                  <div className="flex gap-2 text-[9px] font-black uppercase tracking-[0.18em]">
                    <span className="rounded-xl bg-blue-50 px-3 py-2 text-blue-700">{account.unreadMessages.count} unread</span>
                    <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">{account.returnRequests.count} returns</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-700">Unread messages</p>
                    {account.unreadMessages.error ? (
                      <p className="mt-3 text-sm text-rose-600">{account.unreadMessages.error}</p>
                    ) : account.unreadMessages.items.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">No unread buyer conversations.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {account.unreadMessages.items.map((item) => (
                          <div key={item.conversationId || item.subject} className="rounded-2xl border border-white bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-gray-900">{item.subject}</p>
                                <p className="mt-1 text-[11px] font-medium text-gray-500">
                                  {item.otherPartyUsername} • {item.referenceType || 'MESSAGE'} {item.referenceId || ''}
                                </p>
                              </div>
                              <span className="rounded-lg bg-blue-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-blue-700">
                                {item.unreadCount} unread
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-gray-500">{formatDateTime(item.createdDate)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-700">Return requests</p>
                    {account.returnRequests.error ? (
                      <p className="mt-3 text-sm text-rose-600">{account.returnRequests.error}</p>
                    ) : account.returnRequests.items.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">No active return requests.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {account.returnRequests.items.map((item) => (
                          <div key={item.returnId || item.orderId} className="rounded-2xl border border-white bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-gray-900">Return #{item.returnId || 'Pending'}</p>
                                <p className="mt-1 text-[11px] font-medium text-gray-500">
                                  Order {item.orderId || 'N/A'} • Item {item.itemId || 'N/A'}
                                </p>
                              </div>
                              <span className="rounded-lg bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-amber-700">
                                {item.state}
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-gray-500">{formatDateTime(item.lastModifiedDate || item.creationDate)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-700">Zendesk</p>
                  <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">Open ticket queue</h2>
                </div>
                {zendesk.agentUrl ? (
                  <a
                    href={zendesk.agentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-gray-600"
                  >
                    Open
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">Open tickets</p>
                  <p className="mt-2 text-2xl font-black tracking-tight text-emerald-700">{zendesk.count}</p>
                </div>
                <div className="rounded-2xl bg-rose-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-rose-700">High priority</p>
                  <p className="mt-2 text-2xl font-black tracking-tight text-rose-700">{zendesk.urgentCount}</p>
                </div>
              </div>

              {zendesk.error ? (
                <p className="mt-4 text-sm text-rose-600">{zendesk.error}</p>
              ) : zendesk.tickets.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No open Zendesk tickets.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {zendesk.tickets.map((ticket) => (
                    <a
                      key={ticket.id}
                      href={ticket.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-2xl border border-gray-200 bg-gray-50 p-3 transition-colors hover:bg-gray-100"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{ticket.subject}</p>
                          <p className="mt-1 text-[11px] font-medium text-gray-500">
                            #{ticket.id} • {ticket.requesterName}
                          </p>
                        </div>
                        <span className="rounded-lg bg-white px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-gray-700">
                          {ticket.status}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] font-medium text-gray-500">{formatDateTime(ticket.updatedAt)}</p>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
