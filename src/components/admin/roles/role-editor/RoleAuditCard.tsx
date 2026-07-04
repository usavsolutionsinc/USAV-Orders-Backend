'use client';

import type { AuditEntry } from './role-editor-types';

/** Card D — recent audit: role.* + staff.roles.changed entries touching this role. */
export function RoleAuditCard({ audit }: { audit: AuditEntry[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-default">Recent activity</h2>
          <p className="mt-0.5 text-caption text-text-soft">Last 20 changes touching this role.</p>
        </div>
      </header>
      {audit.length === 0 ? (
        <p className="px-5 py-6 text-center text-caption text-text-faint">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {audit.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2 text-caption">
              <span className="font-mono text-text-muted">{a.event}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wider ring-1 ring-inset ${
                a.result === 'ok' ? 'bg-green-100 text-green-800 ring-green-200'
                : a.result === 'denied' ? 'bg-amber-100 text-amber-800 ring-amber-200'
                : 'bg-red-100 text-red-800 ring-red-200'
              }`}>{a.result}</span>
              <span className="text-text-soft">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
