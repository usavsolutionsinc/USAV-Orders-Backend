'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import type { AlertRow } from '@/hooks/useInventorySearch';
import { InventoryDetailPanelShell } from './InventoryDetailPanelShell';

interface AlertDetailsPanelProps {
    alertId: string;
    onClose?: () => void;
}

/**
 * Read-only Phase 4 view for a single stock_alerts row. The endpoint
 * currently has no detail-by-id route, so we list the matching one out of
 * the bulk feed. Ack/resolve actions land in Phase 5 via a POST.
 */
export function AlertDetailsPanel({ alertId, onClose }: AlertDetailsPanelProps) {
    const [alert, setAlert] = useState<AlertRow | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [acking, setAcking] = useState(false);
    const [ackError, setAckError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                // No `[id]` endpoint yet — pull the open feed and find it.
                const res = await fetch('/api/inventory/alerts?limit=500');
                if (!res.ok) throw new Error(`alerts ${res.status}`);
                const data = (await res.json()) as { items: AlertRow[] };
                if (cancelled) return;
                const match = data.items.find((a) => String(a.id) === alertId) ?? null;
                setAlert(match);
                if (!match) setError(`Alert ${alertId} not found in current feed.`);
            } catch (err: unknown) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Failed to load alert');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [alertId]);

    const handleAck = async () => {
        setAcking(true);
        setAckError(null);
        try {
            const res = await fetch(`/api/inventory/alerts/${encodeURIComponent(alertId)}/ack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: note.trim() || undefined }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || `ack ${res.status}`);
            }
            const data = (await res.json()) as { success: boolean; alert: AlertRow };
            setAlert((prev) => (prev ? { ...prev, resolved_at: data.alert.resolved_at } : data.alert));
            setNote('');
        } catch (err: unknown) {
            setAckError(err instanceof Error ? err.message : 'Failed to ack');
        } finally {
            setAcking(false);
        }
    };

    const title = alert ? alert.rule : `Alert #${alertId}`;
    const subtitle = alert
        ? [alert.sku, alert.bin_barcode].filter(Boolean).join(' · ') || undefined
        : undefined;

    return (
        <InventoryDetailPanelShell
            eyebrow="Alert"
            title={title}
            subtitle={subtitle}
            onClose={onClose}
        >
            {loading ? (
                <div className="flex items-center justify-center py-16 text-text-faint">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="ml-2 text-sm">Loading alert…</span>
                </div>
            ) : error || !alert ? (
                <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error ?? `Alert ${alertId} not found.`}
                    </div>
                </div>
            ) : (
                <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
                    <header className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                            alert.resolved_at ? 'bg-surface-sunken text-text-soft' : alert.severity === 'critical' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                        }`}>
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                            <p className={`${microBadge} ${alert.resolved_at ? 'text-text-soft' : 'text-red-600'}`}>
                                {alert.resolved_at ? 'Resolved' : alert.severity}
                            </p>
                            <p className="text-sm text-text-muted">{alert.rule}</p>
                        </div>
                    </header>

                    <section className="rounded-xl border border-border-soft bg-surface-card">
                        <div className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
                            <Field label="SKU" value={alert.sku ?? '—'} />
                            <Field label="Bin" value={alert.bin_barcode ?? '—'} />
                            <Field label="Raised" value={new Date(alert.raised_at).toLocaleString()} />
                            <Field
                                label="Resolved"
                                value={alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : '—'}
                            />
                        </div>
                    </section>

                    <section className="rounded-xl border border-border-soft bg-surface-card px-5 py-4">
                        <p className={sectionLabel}>Resolve</p>
                        {alert.resolved_at ? (
                            <p className={`${microBadge} mt-2 text-emerald-700`}>
                                Resolved {new Date(alert.resolved_at).toLocaleString()}
                            </p>
                        ) : (
                            <div className="mt-3 space-y-3">
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="Optional note (what changed, who handled it)"
                                    rows={2}
                                    className="w-full resize-none rounded-lg border border-border-soft bg-surface-canvas px-3 py-2 text-sm text-text-default focus:border-blue-400 focus:bg-surface-card focus:outline-none"
                                />
                                {ackError ? (
                                    <p className={`${microBadge} text-red-600`}>{ackError}</p>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="md"
                                    icon={<Check />}
                                    loading={acking}
                                    disabled={acking}
                                    onClick={handleAck}
                                    className="bg-emerald-600 text-white shadow-none hover:bg-emerald-700 active:bg-emerald-700"
                                >
                                    {acking ? 'Acknowledging…' : 'Acknowledge'}
                                </Button>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </InventoryDetailPanelShell>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className={`${microBadge} text-text-soft`}>{label}</dt>
            <dd className="mt-0.5 text-text-default">{value}</dd>
        </div>
    );
}
