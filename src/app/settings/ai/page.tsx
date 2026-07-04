/**
 * /settings/ai — the tenant's AI & Search dashboard.
 *
 * Server component, gated admin.view (billing-page pattern). Everything is
 * resolved from the caller's org in the DB — the connected provider comes
 * from organization_integrations (vault rows), usage from ai_usage_events,
 * the margin from organizations.settings — never code constants.
 *
 * Shows: which provider serves chat/embeddings right now (BYOK vs the
 * platform-metered default), the usage + price breakdown for the window,
 * and where to connect/disconnect providers (Settings → Integrations).
 */

import Link from 'next/link';
import { requirePermission } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/ui/pane-header';
import { resolveOrgAiConfig, type OrgAiConfig } from '@/lib/ai/org-provider';
import { getAiUsageMarginPercent, summarizeAiUsage } from '@/lib/ai/usage';
import { applyMarginMicrocents, microcentsToUsd } from '@/lib/ai/model-pricing';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  ai_gateway: 'Vercel AI Gateway (your key)',
  openai: 'OpenAI (your key)',
  anthropic: 'Anthropic (your key)',
  ollama: 'Self-hosted endpoint (yours)',
  platform: 'Platform default (metered)',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function ProviderCard({ title, config, note }: { title: string; config: OrgAiConfig | null; note?: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-border-soft bg-surface-card p-4">
      <p className="text-micro font-black uppercase tracking-widest text-text-soft">{title}</p>
      {config ? (
        <>
          <p className="text-sm font-semibold text-text-default">{sourceLabel(config.source)}</p>
          <p className="truncate text-caption font-medium text-text-soft">
            {config.model} · via {new URL(config.baseURL).host}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-text-default">Not connected</p>
          <p className="text-caption font-medium text-text-soft">
            {note ?? 'Search falls back to keyword matching until a provider is connected.'}
          </p>
        </>
      )}
    </div>
  );
}

export default async function AiSettingsPage() {
  const user = await requirePermission('admin.view');
  const orgId = user.organizationId as OrgId;
  const days = 30;

  const [chat, embed, summary, marginPercent] = await Promise.all([
    resolveOrgAiConfig(orgId, 'chat'),
    resolveOrgAiConfig(orgId, 'embed'),
    summarizeAiUsage(orgId, days),
    getAiUsageMarginPercent(orgId),
  ]);

  const estimated = summary.reduce((sum, r) => sum + r.costMicrocents, 0);
  const platformCost = summary
    .filter((r) => r.provider === 'platform')
    .reduce((sum, r) => sum + r.costMicrocents, 0);
  const billed = applyMarginMicrocents(platformCost, marginPercent) + (estimated - platformCost);
  const totalCalls = summary.reduce((sum, r) => sum + r.calls, 0);
  const unknownRateCalls = summary.reduce((sum, r) => sum + r.unknownRateCalls, 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface-canvas">
      <PageHeader title="AI & Search" maxWidth="5xl" />
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
        {/* Active providers */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
              Active providers
            </p>
            <Link
              href="/settings/integrations"
              className="text-caption font-semibold text-blue-600 hover:underline"
            >
              Connect / manage providers →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <ProviderCard
              title="Search embeddings (semantic search)"
              config={embed}
              note="Keyword search keeps working; semantic ranking activates when a provider is connected."
            />
            <ProviderCard
              title="Ask AI (natural-language search)"
              config={chat}
              note="The Ask AI action falls back to the classic chat page until connected."
            />
          </div>
          <p className="text-caption font-medium text-text-soft">
            Connect your own key under Integrations → Realtime &amp; AI (Vercel AI Gateway, OpenAI,
            Anthropic, or a self-hosted endpoint). Your key is encrypted at rest and used only for
            your organization. Without a key, your searches use the platform default and appear
            below as metered usage.
          </p>
        </section>

        {/* Price breakdown */}
        <section className="space-y-3">
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
            Usage &amp; pricing · last {days} days
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 rounded-xl border border-border-soft bg-surface-card p-4">
              <p className="text-micro font-black uppercase tracking-widest text-text-soft">AI calls</p>
              <p className="text-xl font-black text-text-default">{totalCalls.toLocaleString()}</p>
            </div>
            <div className="space-y-1 rounded-xl border border-border-soft bg-surface-card p-4">
              <p className="text-micro font-black uppercase tracking-widest text-text-soft">
                Estimated provider cost
              </p>
              <p className="text-xl font-black text-text-default">{microcentsToUsd(estimated)}</p>
            </div>
            <div className="space-y-1 rounded-xl border border-border-soft bg-surface-card p-4">
              <p className="text-micro font-black uppercase tracking-widest text-text-soft">
                Billed{marginPercent > 0 ? ` (cost + ${marginPercent}%)` : ''}
              </p>
              <p className="text-xl font-black text-text-default">{microcentsToUsd(billed)}</p>
              <p className="text-caption font-medium text-text-soft">
                Margin applies to platform-metered usage only — your own keys bill at your provider.
              </p>
            </div>
          </div>

          {summary.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption font-medium text-text-soft">
              No AI usage recorded in this window yet — usage appears here as staff search.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border-soft bg-surface-card">
              <table className="w-full text-left text-caption">
                <thead>
                  <tr className="border-b border-border-hairline text-micro font-black uppercase tracking-widest text-text-soft">
                    <th className="px-4 py-2">Use</th>
                    <th className="px-4 py-2">Provider</th>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2 text-right">Calls</th>
                    <th className="px-4 py-2 text-right">Tokens in / out</th>
                    <th className="px-4 py-2 text-right">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-hairline">
                  {summary.map((row) => (
                    <tr key={`${row.context}:${row.provider}:${row.model}`} className="text-text-muted">
                      <td className="px-4 py-2 font-semibold">
                        {row.context === 'ask_ai'
                          ? 'Ask AI'
                          : row.context === 'query_embed'
                            ? 'Search queries'
                            : 'Index embedding'}
                      </td>
                      <td className="px-4 py-2">{sourceLabel(row.provider)}</td>
                      <td className="px-4 py-2 font-mono text-micro">{row.model}</td>
                      <td className="px-4 py-2 text-right">{row.calls.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {microcentsToUsd(row.costMicrocents)}
                        {row.unknownRateCalls > 0 ? ' *' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unknownRateCalls > 0 && (
            <p className="text-caption font-medium text-text-soft">
              * {unknownRateCalls.toLocaleString()} call(s) used a model without a published rate —
              tokens are counted, cost shown excludes them.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
