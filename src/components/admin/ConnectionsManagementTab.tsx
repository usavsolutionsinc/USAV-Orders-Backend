'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ConnectionLogEntryInput } from '@/components/sidebar/ConnectionsSidebarPanel';
import { ZohoManagementPage } from '@/components/admin/connections/ZohoManagementPage';

interface ConnectionLogEntry extends ConnectionLogEntryInput {
  id: string;
  createdAt: string;
}

export function ConnectionsManagementTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([]);
  const page = String(searchParams.get('page') || '').trim().toLowerCase();
  const isZohoManagement = page === 'zoho-management';

  useEffect(() => {
    const handleLog = (event: Event) => {
      const customEvent = event as CustomEvent<ConnectionLogEntryInput>;
      const entry = customEvent.detail;
      if (!entry) return;
      setLogs((current) => [
        {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toLocaleString(),
        },
        ...current,
      ]);
    };

    window.addEventListener('admin-connections-log', handleLog as EventListener);
    return () => {
      window.removeEventListener('admin-connections-log', handleLog as EventListener);
    };
  }, []);

  const groupedSummary = useMemo(() => {
    const counts = { success: 0, error: 0, info: 0 };
    for (const log of logs) counts[log.status] += 1;
    return counts;
  }, [logs]);

  const navigateTo = (nextPage: '' | 'zoho-management') => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage) params.set('page', nextPage);
    else params.delete('page');
    router.replace(`/admin?${params.toString()}`);
  };

  if (isZohoManagement) {
    return <ZohoManagementPage />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-500">Sync Activity</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Connections Log</h3>
              <p className="mt-1 text-[11px] font-bold leading-relaxed text-gray-500">
                Actions triggered from the sidebar write their outcomes here so the sync surface stays flat and operational.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <button
                type="button"
                onClick={() => navigateTo('zoho-management')}
                className="border-b border-gray-900 py-1 text-[10px] font-black uppercase tracking-widest text-gray-900"
              >
                Zoho Management
              </button>
              <span>Success {groupedSummary.success}</span>
              <span>Error {groupedSummary.error}</span>
              <span>Total {logs.length}</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {logs.length === 0 ? (
            <div className="border border-dashed border-gray-200 px-5 py-10 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">No Sync Activity Yet</p>
              <p className="mt-2 text-[11px] font-bold text-gray-500">
                Run a connection action from the sidebar to capture update details here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 border border-gray-200">
              {logs.map((log) => (
                <div key={log.id} className="grid gap-3 px-4 py-4 md:grid-cols-[120px_minmax(0,1fr)_140px] md:items-start">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">{log.group}</p>
                    <p
                      className={`mt-1 text-[10px] font-black uppercase tracking-widest ${
                        log.status === 'success'
                          ? 'text-green-700'
                          : log.status === 'error'
                            ? 'text-red-700'
                            : 'text-gray-700'
                      }`}
                    >
                      {log.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">{log.title}</p>
                    <p className="mt-1 text-[11px] font-bold leading-relaxed text-gray-600">{log.detail}</p>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 md:text-right">
                    {log.createdAt}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
  );
}
