'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertTriangle,
    Barcode,
    Check,
    Clock,
    Loader2,
    RotateCcw,
    Truck,
    User,
    X,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';

/** Full `tracking_exceptions` row (GET /api/tracking-exceptions/[id]). */
interface ExceptionDetail {
    id: number;
    tracking_number: string;
    domain: string;
    source_station: string | null;
    staff_id: number | null;
    staff_name: string | null;
    staff_display_name: string | null;
    exception_reason: string | null;
    notes: string | null;
    status: string;
    receiving_id: number | null;
    receiving_source: string | null;
    receiving_carrier: string | null;
    zoho_check_count: number | null;
    last_zoho_check_at: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
}

interface TriageWorkspaceProps {
    /** `?open=` — the tracking_exception id selected in the sidebar. */
    selectedId: string | null;
}

const STATUS_TONE: Record<string, string> = {
    open: 'bg-amber-50 text-amber-700',
    resolved: 'bg-emerald-50 text-emerald-700',
    discarded: 'bg-gray-100 text-gray-500',
};

function formatWhen(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

export function TriageWorkspace({ selectedId }: TriageWorkspaceProps) {
    const queryClient = useQueryClient();

    const { data, isLoading, isError, error } = useQuery<ExceptionDetail>({
        queryKey: ['triage-exception', selectedId],
        enabled: !!selectedId,
        queryFn: async ({ signal }) => {
            const res = await fetch(`/api/tracking-exceptions/${selectedId}`, {
                signal,
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            return body.exception as ExceptionDetail;
        },
    });

    const [notes, setNotes] = useState('');
    useEffect(() => {
        setNotes(data?.notes ?? '');
    }, [data?.id, data?.notes]);

    const patch = useMutation({
        mutationFn: async (patchBody: Record<string, unknown>) => {
            const res = await fetch(`/api/tracking-exceptions/${selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(patchBody),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['triage-exception', selectedId] });
            queryClient.invalidateQueries({ queryKey: ['triage-exceptions'] });
        },
    });

    if (!selectedId) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <div className="space-y-2 text-center">
                    <AlertTriangle className="mx-auto h-12 w-12 opacity-20" />
                    <p className="text-sm font-medium">Select an issue from the sidebar to begin triage</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading issue…</span>
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <div className="mx-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error instanceof Error ? error.message : 'Failed to load this issue.'}
                </div>
            </div>
        );
    }

    const reporter = data.staff_display_name || data.staff_name || 'Unknown';
    const isOpen = data.status === 'open';

    return (
        <div className="flex h-full w-full min-w-0 flex-col bg-white">
            {/* Header */}
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-100 bg-white/50 px-6 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            'rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider',
                            STATUS_TONE[data.status] ?? 'bg-gray-100 text-gray-500',
                        )}
                    >
                        {data.status}
                    </span>
                    <div className="mx-1 h-4 w-px bg-gray-200" />
                    <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        Opened {formatWhen(data.created_at)}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isOpen ? (
                        <>
                            <button
                                type="button"
                                onClick={() => patch.mutate({ status: 'resolved' })}
                                disabled={patch.isPending}
                                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                                <Check className="h-3.5 w-3.5" /> Resolve
                            </button>
                            <button
                                type="button"
                                onClick={() => patch.mutate({ status: 'discarded' })}
                                disabled={patch.isPending}
                                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-60"
                            >
                                <X className="h-3.5 w-3.5" /> Discard
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => patch.mutate({ status: 'open' })}
                            disabled={patch.isPending}
                            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-60"
                        >
                            <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </button>
                    )}
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="mx-auto max-w-4xl space-y-8">
                    {/* Summary */}
                    <div className="space-y-1">
                        <h1 className="font-mono text-3xl font-black tracking-tight text-gray-900">
                            {data.tracking_number}
                        </h1>
                        <p className="text-lg font-bold text-gray-500">
                            {data.exception_reason || 'Exception'}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-8">
                        <Field label="Reported by" icon={<User className="h-3.5 w-3.5 text-blue-600" />}>
                            {reporter}
                        </Field>
                        <Field label="Source station" icon={<Barcode className="h-3.5 w-3.5 text-blue-600" />}>
                            {data.source_station || '—'}
                        </Field>
                        <Field label="Domain" icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-500" />}>
                            {data.domain}
                        </Field>
                        {data.receiving_carrier ? (
                            <Field label="Carrier" icon={<Truck className="h-3.5 w-3.5 text-blue-600" />}>
                                {data.receiving_carrier}
                            </Field>
                        ) : null}
                        {data.receiving_source ? (
                            <Field label="Receiving source">{data.receiving_source}</Field>
                        ) : null}
                        {data.resolved_at ? (
                            <Field label="Resolved">{formatWhen(data.resolved_at)}</Field>
                        ) : null}
                        {data.zoho_check_count != null ? (
                            <Field label="Zoho checks">
                                {`${data.zoho_check_count}${
                                    data.last_zoho_check_at ? ` · ${formatWhen(data.last_zoho_check_at)}` : ''
                                }`}
                            </Field>
                        ) : null}
                    </div>

                    {/* Notes */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Notes</h3>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add triage notes…"
                            className="min-h-[120px] w-full rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                        />
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => patch.mutate({ notes: notes.trim() || null })}
                                disabled={patch.isPending || notes === (data.notes ?? '')}
                                className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white shadow-lg disabled:opacity-40"
                            >
                                {patch.isPending ? 'Saving…' : 'Save note'}
                            </button>
                            {patch.isError ? (
                                <span className="text-xs font-medium text-rose-600">Save failed.</span>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Field({
    label,
    icon,
    children,
}: {
    label: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
            <div className="flex items-center gap-2">
                {icon}
                <span className="text-sm font-black text-gray-900">{children}</span>
            </div>
        </div>
    );
}
