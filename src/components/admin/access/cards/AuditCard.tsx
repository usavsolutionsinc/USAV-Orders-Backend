'use client';

import { Fragment, useState } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { fmtRelative, type AuditEntry } from '../staff-access-shared';

interface AuditCardProps {
  audit: AuditEntry[];
  borderClass: string;
}

export function AuditCard({ audit, borderClass }: AuditCardProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-white shadow-sm`}>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Recent audit</h2>
          <p className="mt-0.5 text-caption text-gray-500">Last 20 events for this staff. Click a row for full detail.</p>
        </div>
      </header>
      {audit.length === 0 ? (
        <p className="px-5 py-6 text-center text-caption text-gray-400">No audit entries yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {audit.map((a) => (
            <AuditRow key={a.id} entry={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function summarizeAudit(entry: AuditEntry): { headline: string | null; reason: string | null } {
  const d = entry.detail || {};
  const permission = typeof d.permission === 'string' ? d.permission : null;
  const path = typeof d.path === 'string' ? d.path : null;
  const surface = d.api ? 'API' : d.page ? 'Page' : null;

  if (entry.event === 'permission.denied') {
    const headline = path ? `${surface ?? 'Access'}: ${path}` : surface;
    const reason = permission ? `Missing permission "${permission}"` : 'Permission check failed';
    return { headline: headline ?? null, reason };
  }

  return { headline: path, reason: null };
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const { headline, reason } = summarizeAudit(entry);
  const detailKeys = Object.keys(entry.detail || {});
  const hasDetail = detailKeys.length > 0 || entry.user_agent || entry.sid;
  const absolute = new Date(entry.created_at).toLocaleString();

  return (
    <li className="text-caption">
      {/* ds-raw-button: full-width text-left multi-column expandable audit row, not a standard action button */}
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full flex-wrap items-center gap-3 px-5 py-2 text-left ${hasDetail ? 'hover:bg-gray-50' : 'cursor-default'}`}
      >
        <span className="font-mono text-gray-700">{entry.event}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${
          entry.result === 'ok' ? 'bg-green-100 text-green-800 ring-green-200'
          : entry.result === 'denied' ? 'bg-amber-100 text-amber-800 ring-amber-200'
          : 'bg-red-100 text-red-800 ring-red-200'
        }`}>{entry.result}</span>
        <HoverTooltip label={absolute} asChild focusable={false}>
          <span className="text-gray-500">{fmtRelative(entry.created_at)}</span>
        </HoverTooltip>
        {entry.ip && <span className="text-gray-400">{entry.ip}</span>}
        {headline && <span className="ml-auto truncate text-gray-600">{headline}</span>}
        {hasDetail && (
          <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>
        )}
      </button>
      {open && (
        <div className="bg-gray-50 px-5 py-3 text-micro text-gray-700">
          {reason && (
            <div className="mb-2">
              <span className="font-semibold text-gray-800">Reason: </span>
              <span className="text-gray-700">{reason}</span>
            </div>
          )}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-500">When</dt>
            <dd className="font-mono text-gray-800">{absolute}</dd>
            {entry.ip && (<>
              <dt className="text-gray-500">IP</dt>
              <dd className="font-mono text-gray-800">{entry.ip}</dd>
            </>)}
            {entry.sid && (<>
              <dt className="text-gray-500">Session</dt>
              <dd className="font-mono text-gray-800 break-all">{entry.sid}</dd>
            </>)}
            {entry.user_agent && (<>
              <dt className="text-gray-500">User-Agent</dt>
              <dd className="text-gray-800 break-all">{entry.user_agent}</dd>
            </>)}
            {detailKeys.map((k) => {
              const v = (entry.detail as Record<string, unknown>)[k];
              const rendered = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
                ? String(v)
                : JSON.stringify(v);
              return (
                <Fragment key={k}>
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-mono text-gray-800 break-all">{rendered}</dd>
                </Fragment>
              );
            })}
          </dl>
        </div>
      )}
    </li>
  );
}
