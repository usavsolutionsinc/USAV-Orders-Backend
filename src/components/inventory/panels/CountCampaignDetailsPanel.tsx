'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, Loader2 } from '@/components/Icons';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import type { CountRow } from '@/hooks/useInventorySearch';
import { InventoryDetailPanelShell } from './InventoryDetailPanelShell';

interface CountCampaignDetailsPanelProps {
    campaignId: string;
    onClose?: () => void;
}

/**
 * Read-only Phase 4 view for a single cycle_count_campaigns row. Per-line
 * execution lands in Phase 5 with `/api/inventory/counts/[id]/lines` and
 * the line PATCH endpoint.
 */
export function CountCampaignDetailsPanel({ campaignId, onClose }: CountCampaignDetailsPanelProps) {
    const [campaign, setCampaign] = useState<CountRow | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const res = await fetch('/api/inventory/counts?limit=200');
                if (!res.ok) throw new Error(`counts ${res.status}`);
                const data = (await res.json()) as { items: CountRow[] };
                if (cancelled) return;
                const match = data.items.find((c) => String(c.id) === campaignId) ?? null;
                setCampaign(match);
                if (!match) setError(`Campaign ${campaignId} not found.`);
            } catch (err: unknown) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Failed to load campaign');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [campaignId]);

    const title = campaign ? campaign.name : `Campaign #${campaignId}`;
    const subtitle = campaign ? campaign.zone ?? undefined : undefined;

    return (
        <InventoryDetailPanelShell
            eyebrow="Cycle Count"
            title={title}
            subtitle={subtitle}
            onClose={onClose}
        >
            {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="ml-2 text-sm">Loading campaign…</span>
                </div>
            ) : error || !campaign ? (
                <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error ?? `Campaign ${campaignId} not found.`}
                    </div>
                </div>
            ) : (
                <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
                    <header className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                            <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                            <p className={`${microBadge} text-blue-600`}>{campaign.status.replace(/_/g, ' ')}</p>
                            <p className="text-sm text-gray-700">{campaign.name}</p>
                        </div>
                    </header>

                    <section className="rounded-xl border border-gray-200 bg-white">
                        <div className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
                            <Field label="Zone" value={campaign.zone ?? '—'} />
                            <Field
                                label="Lines"
                                value={String(campaign.line_count)}
                            />
                            <Field
                                label="Progress"
                                value={campaign.progress_pct != null ? `${Math.round(campaign.progress_pct * 100)}%` : '—'}
                            />
                            <Field
                                label="Opened"
                                value={campaign.opened_at ? new Date(campaign.opened_at).toLocaleString() : '—'}
                            />
                        </div>
                        {campaign.progress_pct != null ? (
                            <div className="border-t border-gray-100 px-5 py-3">
                                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                    <div
                                        className="h-full bg-blue-500 transition-all"
                                        style={{ width: `${Math.round(campaign.progress_pct * 100)}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </section>

                    <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4">
                        <p className={sectionLabel}>Lines</p>
                        <p className={`${microBadge} mt-1 text-gray-500`}>
                            Per-line execution + approve/reject lands in Phase 5 via /api/inventory/counts/[id]/lines.
                        </p>
                    </section>
                </div>
            )}
        </InventoryDetailPanelShell>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className={`${microBadge} text-gray-500`}>{label}</dt>
            <dd className="mt-0.5 text-gray-900">{value}</dd>
        </div>
    );
}
