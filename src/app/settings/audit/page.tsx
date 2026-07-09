/**
 * /settings/audit — admin-facing audit log viewer.
 *
 * Reads from `audit_logs` (the rich diff table written by withAuth's
 * audit-floor and by handlers via recordAudit). Filter by source/action,
 * paginate, expand a row to see the before/after JSON.
 *
 * Tenant scoping: audit_logs doesn't have organization_id yet (next
 * migration wave). For now we filter by actor_staff_id ∈ staff of this
 * tenant — which is correct because every audit row is attributable to a
 * staff member, and staff are already tenant-scoped. Once audit_logs
 * carries org_id directly we'll switch.
 *
 * Gated by admin.view_logs.
 */

import { requirePermission } from '@/lib/auth/page-guard';
import pool from '@/lib/db';
import { PageHeader } from '@/components/ui/pane-header';
import { Button } from '@/design-system/primitives';

interface AuditRow {
  id: number;
  created_at: Date;
  actor_staff_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  source: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string | null;
  metadata: unknown;
  before_data: unknown;
  after_data: unknown;
}

const PAGE_SIZE = 50;

function fmtTs(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

interface PageProps {
  searchParams: Promise<{ source?: string; action?: string; cursor?: string }>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const user = await requirePermission('admin.view_logs');
  const params = await searchParams;
  const source = params.source?.trim() || null;
  const action = params.action?.trim() || null;
  const cursor = Number(params.cursor) || null;

  // Filter by actors who belong to this tenant. JOIN staff to display the
  // actor name + role at the time of read (the audit row caches role at
  // write time, but the name is on staff).
  const whereParts: string[] = ['s.organization_id = $1'];
  const args: unknown[] = [user.organizationId];
  if (source) { args.push(source); whereParts.push(`a.source = $${args.length}`); }
  if (action) { args.push(action); whereParts.push(`a.action = $${args.length}`); }
  if (cursor) { args.push(cursor); whereParts.push(`a.id < $${args.length}`); }

  args.push(PAGE_SIZE + 1); // +1 so we know if there's a next page

  const r = await pool.query<AuditRow>(
    `SELECT a.id, a.created_at, a.actor_staff_id, s.name AS actor_name, a.actor_role,
            a.source, a.action, a.entity_type, a.entity_id, a.ip_address,
            a.metadata, a.before_data, a.after_data
       FROM audit_logs a
       LEFT JOIN staff s ON s.id = a.actor_staff_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT $${args.length}`,
    args,
  );
  const rows = r.rows.slice(0, PAGE_SIZE);
  const hasMore = r.rows.length > PAGE_SIZE;
  const nextCursor = hasMore ? rows[rows.length - 1]?.id : null;

  return (
    <div className="min-h-screen bg-surface-canvas antialiased">
      <PageHeader title="Audit log" maxWidth="6xl" />
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <p className="text-sm text-text-soft">
          Every privileged write, every permission denial. Last {PAGE_SIZE} rows{source || action ? ' matching filter' : ''}.
        </p>

        <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-soft bg-surface-card p-3 text-label shadow-sm">
          <label className="flex items-center gap-2">
            <span className="font-medium text-text-soft">Source</span>
            <input
              name="source"
              defaultValue={source ?? ''}
              placeholder="e.g. receiving"
              className="rounded-lg border border-border-soft bg-surface-card px-2.5 py-1 text-label focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-border-soft"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="font-medium text-text-soft">Action</span>
            <input
              name="action"
              defaultValue={action ?? ''}
              placeholder="e.g. mark_received"
              className="rounded-lg border border-border-soft bg-surface-card px-2.5 py-1 text-label focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-border-soft"
            />
          </label>
          <Button variant="brand" size="sm" type="submit">Apply</Button>
          {(source || action) && (
            <a href="/settings/audit" className="font-medium text-text-soft hover:text-text-default">Clear</a>
          )}
        </form>

        <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-sm">
          <table className="min-w-full divide-y divide-border-hairline text-[12.5px]">
            <thead className="bg-surface-canvas text-left text-caption font-medium uppercase tracking-[0.08em] text-text-soft">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Source · Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-hairline">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-text-faint">No audit entries match.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="text-text-default">
                  <td className="px-3 py-2 align-top font-mono text-[11.5px] text-text-muted">{fmtTs(row.created_at)}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{row.actor_name ?? `#${row.actor_staff_id ?? '—'}`}</div>
                    {row.actor_role && <div className="text-[10.5px] text-text-soft">{row.actor_role}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{row.action}</div>
                    <div className="text-[10.5px] text-text-soft">{row.source}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{row.entity_type}</div>
                    <div className="font-mono text-[10.5px] text-text-soft">{row.entity_id}</div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-[10.5px] text-text-soft">{row.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="text-right">
            <a
              className="inline-flex items-center rounded-2xl border border-border-soft bg-surface-card px-3 py-1.5 text-label font-medium text-text-muted shadow-sm hover:text-text-default"
              href={`?${new URLSearchParams({
                ...(source ? { source } : {}),
                ...(action ? { action } : {}),
                cursor: String(nextCursor),
              }).toString()}`}
            >
              Older →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
