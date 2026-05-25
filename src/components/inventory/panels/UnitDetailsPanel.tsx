'use client';

import { useCallback, useEffect, useState } from 'react';
import { ByUnitView } from '@/components/inventory/ByUnitView';
import { Check, Loader2, ShieldCheck } from '@/components/Icons';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import { CONDITION_GRADE_VALUES } from '@/components/inventory/types';
import { InventoryDetailPanelShell } from './InventoryDetailPanelShell';

export interface UnitDetailsPanelProps {
    /** Either a numeric serial_units.id or a serial_number string. */
    ref: string;
    onClose?: () => void;
}

interface UnitSummary {
    id: number;
    current_status: string;
    condition_grade: string | null;
    serial_number: string;
}

export function UnitDetailsPanel({ ref, onClose }: UnitDetailsPanelProps) {
    const [summary, setSummary] = useState<UnitSummary | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/serial-units/${encodeURIComponent(ref)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                const u = data?.serial_unit;
                if (u) {
                    setSummary({
                        id: u.id,
                        current_status: u.current_status,
                        condition_grade: u.condition_grade,
                        serial_number: u.serial_number,
                    });
                }
            } catch {
                /* the embedded ByUnitView will surface load errors */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [ref, refreshKey]);

    const onMutated = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);

    return (
        <InventoryDetailPanelShell
            eyebrow="Unit"
            title={ref}
            onClose={onClose}
        >
            {summary ? (
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 space-y-4">
                    <GradeActionCard
                        unitId={summary.id}
                        currentGrade={summary.condition_grade}
                        onMutated={onMutated}
                    />
                    <HoldActionCard
                        unitId={summary.id}
                        currentStatus={summary.current_status}
                        onMutated={onMutated}
                    />
                </div>
            ) : null}
            <ByUnitView key={refreshKey} ref={ref} />
        </InventoryDetailPanelShell>
    );
}

// ─── Grade ───────────────────────────────────────────────────────────────────

interface GradeActionCardProps {
    unitId: number;
    currentGrade: string | null;
    onMutated: () => void;
}

function GradeActionCard({ unitId, currentGrade, onMutated }: GradeActionCardProps) {
    const [newGrade, setNewGrade] = useState<string>(currentGrade ?? 'USED_A');
    const [cosmetic, setCosmetic] = useState('');
    const [functional, setFunctional] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const disabled = busy || newGrade === currentGrade;

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/serial-units/${unitId}/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    new_grade: newGrade,
                    cosmetic_notes: cosmetic.trim() || undefined,
                    functional_notes: functional.trim() || undefined,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || `grade ${res.status}`);
            }
            setCosmetic('');
            setFunctional('');
            onMutated();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to grade');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
                <p className={sectionLabel}>Grade</p>
                <p className={`${microBadge} text-gray-500`}>Current: {currentGrade ?? '—'}</p>
            </div>
            <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                    {CONDITION_GRADE_VALUES.map((g) => {
                        const active = g === newGrade;
                        return (
                            <button
                                key={g}
                                type="button"
                                onClick={() => setNewGrade(g)}
                                className={[
                                    'rounded-full border px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-wide transition-colors',
                                    active
                                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-600',
                                ].join(' ')}
                            >
                                {g.replace(/_/g, ' ')}
                            </button>
                        );
                    })}
                </div>
                <input
                    value={cosmetic}
                    onChange={(e) => setCosmetic(e.target.value)}
                    placeholder="Cosmetic notes (optional)"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                <input
                    value={functional}
                    onChange={(e) => setFunctional(e.target.value)}
                    placeholder="Functional notes (optional)"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                {error ? <p className={`${microBadge} text-red-600`}>{error}</p> : null}
                <button
                    type="button"
                    disabled={disabled}
                    onClick={submit}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {busy ? 'Saving…' : 'Save grade'}
                </button>
            </div>
        </section>
    );
}

// ─── Hold / Release ──────────────────────────────────────────────────────────

interface HoldActionCardProps {
    unitId: number;
    currentStatus: string;
    onMutated: () => void;
}

function HoldActionCard({ unitId, currentStatus, onMutated }: HoldActionCardProps) {
    const onHold = currentStatus === 'ON_HOLD';
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!onHold && !reason.trim()) {
            setError('Reason is required to place a hold');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const path = onHold
                ? `/api/serial-units/${unitId}/release`
                : `/api/serial-units/${unitId}/hold`;
            const res = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason.trim() || undefined }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || `${onHold ? 'release' : 'hold'} ${res.status}`);
            }
            setReason('');
            onMutated();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
                <p className={sectionLabel}>Hold</p>
                <p className={`${microBadge} ${onHold ? 'text-red-600' : 'text-gray-500'}`}>
                    Status: {currentStatus.replace(/_/g, ' ')}
                </p>
            </div>
            <div className="mt-3 space-y-3">
                <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={onHold ? 'Release reason (optional)' : 'Hold reason (required)'}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
                />
                {error ? <p className={`${microBadge} text-red-600`}>{error}</p> : null}
                <button
                    type="button"
                    disabled={busy}
                    onClick={submit}
                    className={[
                        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50',
                        onHold ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
                    ].join(' ')}
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {busy ? 'Working…' : onHold ? 'Release hold' : 'Place on hold'}
                </button>
            </div>
        </section>
    );
}
