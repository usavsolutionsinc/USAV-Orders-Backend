/**
 * /settings/integrations/diagnostics — admin/support diagnostics for the org's
 * integrations (production-integrations plan §4.2).
 *
 * Read-only Monitor surface, server component. Three panels:
 *   1. Connection grid — listConnections() (vault rows × connector metadata).
 *   2. Credential usage (last 24h) — integration_credential_audit rollup;
 *      degrades to a dashed empty state when the table isn't applied yet.
 *   3. Recent sync runs — cron_runs filtered to integration jobs (the plan
 *      names this `cron_run_log`; the live table is `cron_runs`, written by
 *      withCronRun and already admin.view-gated via /api/cron-runs). Global
 *      per-deployment operational data, not tenant data.
 *
 * Gated by admin.view at the page level, same as the sibling
 * /settings/integrations page. No mutations; every sub-query degrades to an
 * empty state instead of failing the page.
 */

import Link from 'next/link';
import { requirePermission } from '@/lib/auth/page-guard';
import pool from '@/lib/db';
import { listConnections } from '@/lib/integrations/connectors/connections';
import type { ConnectionStatus } from '@/lib/integrations/connectors/types';

export const dynamic = 'force-dynamic';

interface CredentialUsageRow {
  provider: string;
  operation: string;
  outcome: string;
  n: number;
  last_at: Date;
}

interface CronRunRow {
  job: string;
  status: 'running' | 'success' | 'failed';
  trigger: string;
  started_at: Date;
  duration_ms: number | null;
  error: string | null;
}

function relTime(d: Date | null): string {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const STATE_DOT: Record<ConnectionStatus['state'], string> = {
  active: 'bg-emerald-500',
  error: 'bg-rose-500',
  revoked: 'bg-amber-500',
  expired: 'bg-amber-500',
  disconnected: 'bg-surface-inverse-soft',
};

const OUTCOME_CHIP: Record<string, string> = {
  allowed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  denied: 'bg-rose-50 text-rose-700 ring-rose-200',
  error: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const RUN_CHIP: Record<CronRunRow['status'], string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  running: 'bg-blue-50 text-blue-700 ring-blue-200',
};

/** Jobs on the cron registry that belong to the integrations layer. */
const INTEGRATION_JOB_RE = String.raw`^(ebay|zoho|google_sheets|amazon|square|shipstation|nextiva|shipping|integrations)([._]|$)`;

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-soft bg-surface-sunken px-4 py-6 text-center text-caption text-text-faint">
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-caption font-black uppercase tracking-[0.18em] text-text-faint">{children}</h2>
  );
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`rounded ${tone} px-1.5 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ring-inset`}
    >
      {children}
    </span>
  );
}

export default async function IntegrationsDiagnosticsPage() {
  const user = await requirePermission('admin.view');
  const orgId = user.organizationId;

  // Connection grid — degrade to empty on failure, never 500 the page.
  let connections: ConnectionStatus[] = [];
  try {
    connections = await listConnections(orgId);
  } catch {
    connections = [];
  }

  // Credential usage — the audit table's migration may not be applied yet
  // (its writer is best-effort and swallows a missing table; mirror that).
  let credentialUsage: CredentialUsageRow[] | null = null;
  try {
    const reg = await pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.integration_credential_audit')::text AS t`,
    );
    if (reg.rows[0]?.t) {
      const r = await pool.query<CredentialUsageRow>(
        `SELECT provider, operation, outcome, COUNT(*)::int AS n, MAX(created_at) AS last_at
           FROM integration_credential_audit
          WHERE organization_id = $1
            AND created_at > now() - interval '24 hours'
          GROUP BY provider, operation, outcome
          ORDER BY MAX(created_at) DESC
          LIMIT 40`,
        [orgId],
      );
      credentialUsage = r.rows;
    }
  } catch {
    credentialUsage = null;
  }

  // Recent integration cron/sync runs (global operational feed, admin-gated —
  // same exposure as /api/cron-runs).
  let cronRuns: CronRunRow[] | null = null;
  try {
    const reg = await pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.cron_runs')::text AS t`,
    );
    if (reg.rows[0]?.t) {
      const r = await pool.query<CronRunRow>(
        `SELECT job, status, trigger, started_at, duration_ms, error
           FROM cron_runs
          WHERE job ~ $1
          ORDER BY started_at DESC
          LIMIT 20`,
        [INTEGRATION_JOB_RE],
      );
      cronRuns = r.rows;
    }
  } catch {
    cronRuns = null;
  }

  const denied24h = (credentialUsage ?? []).filter((r) => r.outcome === 'denied').reduce((s, r) => s + r.n, 0);
  const errored = connections.filter((c) => c.state === 'error').length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas antialiased">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-text-soft">
              Read-only diagnostics for this workspace&apos;s integrations — connection states, credential usage, and
              recent sync runs.
            </p>
            <div className="flex items-center gap-2">
              {errored > 0 && (
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-caption font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                  {errored} connection{errored === 1 ? '' : 's'} in error
                </span>
              )}
              {denied24h > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-caption font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                  {denied24h} denied credential use{denied24h === 1 ? '' : 's'} · 24h
                </span>
              )}
              <Link
                href="/settings/integrations"
                className="rounded-full bg-surface-sunken px-2.5 py-1 text-caption font-semibold text-text-muted transition-colors hover:text-text-default"
              >
                ← Integrations
              </Link>
            </div>
          </div>

          {/* 1 — Connection grid */}
          <section className="space-y-3">
            <Eyebrow>Connections</Eyebrow>
            {connections.length === 0 ? (
              <EmptyBox>No integration connections yet. Connect a provider under Settings → Integrations.</EmptyBox>
            ) : (
              <div className="divide-y divide-border-hairline rounded-xl border border-border-soft bg-surface-card">
                {connections.map((c) => (
                  <div key={`${c.provider}-${c.scope ?? ''}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[c.state]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-caption font-bold text-text-default">
                        {c.provider}
                        {c.scope ? <span className="font-normal text-text-faint"> · {c.scope}</span> : null}
                      </p>
                      <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                        {c.state}
                        {c.displayLabel ? ` · ${c.displayLabel}` : ''}
                        {c.lastError ? ` · ${c.lastError}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.capabilities.map((cap) => (
                        <Chip key={cap} tone="bg-surface-sunken text-text-muted ring-border-soft">
                          {cap}
                        </Chip>
                      ))}
                      <Chip tone="bg-blue-50 text-blue-700 ring-blue-200">{c.authKind}</Chip>
                      <span className="w-20 text-right text-micro font-semibold tabular-nums text-text-faint">
                        {relTime(c.lastUsedAt ?? null)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2 — Credential usage (24h) */}
          <section className="space-y-3">
            <Eyebrow>Credential usage · last 24h</Eyebrow>
            {credentialUsage === null ? (
              <EmptyBox>
                Credential audit log isn&apos;t available yet — apply the 2026-06-20 integration_credential_audit
                migration to enable this panel.
              </EmptyBox>
            ) : credentialUsage.length === 0 ? (
              <EmptyBox>No credential activity recorded in the last 24 hours.</EmptyBox>
            ) : (
              <div className="divide-y divide-border-hairline rounded-xl border border-border-soft bg-surface-card">
                {credentialUsage.map((r, i) => (
                  <div key={`${r.provider}-${r.operation}-${r.outcome}-${i}`} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-caption font-bold text-text-default">
                        {r.provider}
                        <span className="font-normal text-text-faint"> · {r.operation}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Chip tone={OUTCOME_CHIP[r.outcome] ?? 'bg-surface-sunken text-text-muted ring-border-soft'}>
                        {r.outcome}
                      </Chip>
                      <span className="w-10 text-right text-caption font-bold tabular-nums text-text-muted">
                        ×{r.n}
                      </span>
                      <span className="w-20 text-right text-micro font-semibold tabular-nums text-text-faint">
                        {relTime(r.last_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3 — Recent sync runs */}
          <section className="space-y-3">
            <Eyebrow>Recent sync runs</Eyebrow>
            {cronRuns === null ? (
              <EmptyBox>Sync run history isn&apos;t available yet — the cron_runs table hasn&apos;t been applied.</EmptyBox>
            ) : cronRuns.length === 0 ? (
              <EmptyBox>No integration sync runs recorded yet.</EmptyBox>
            ) : (
              <div className="divide-y divide-border-hairline rounded-xl border border-border-soft bg-surface-card">
                {cronRuns.map((r, i) => (
                  <div key={`${r.job}-${i}`} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-caption font-bold text-text-default">{r.job}</p>
                      {r.error ? (
                        <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-rose-700">
                          {r.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Chip tone="bg-surface-sunken text-text-muted ring-border-soft">{r.trigger}</Chip>
                      <Chip tone={RUN_CHIP[r.status]}>{r.status}</Chip>
                      <span className="w-14 text-right text-micro font-semibold tabular-nums text-text-faint">
                        {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </span>
                      <span className="w-20 text-right text-micro font-semibold tabular-nums text-text-faint">
                        {relTime(r.started_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
