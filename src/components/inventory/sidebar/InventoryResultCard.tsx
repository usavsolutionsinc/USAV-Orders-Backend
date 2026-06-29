'use client';

import { Check, Copy } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import type { InventoryResultRow } from '@/hooks/useInventorySearch';

interface InventoryResultCardProps {
    row: InventoryResultRow;
    isActive: boolean;
    onClick: () => void;
    onCopy: (text: string) => void;
    copied: boolean;
}

function statusBadgeClass(tone: 'gray' | 'emerald' | 'amber' | 'red' | 'blue'): string {
    switch (tone) {
        case 'emerald': return 'bg-emerald-100 text-emerald-700';
        case 'amber':   return 'bg-amber-100 text-amber-700';
        case 'red':     return 'bg-red-100 text-red-700';
        case 'blue':    return 'bg-blue-100 text-blue-700';
        default:        return 'bg-gray-100 text-gray-700';
    }
}

function renderBody(row: InventoryResultRow): {
    title: string;
    subtitle: string;
    meta: string;
    badge: { label: string; tone: 'gray' | 'emerald' | 'amber' | 'red' | 'blue' } | null;
    copyText: string;
} {
    switch (row.kind) {
        case 'bin': {
            const r = row.row;
            const fill = r.fill_pct != null ? `${Math.round(r.fill_pct * 100)}%` : '—';
            const badge = r.is_empty
                ? { label: 'Empty', tone: 'gray' as const }
                : r.is_over_capacity
                    ? { label: 'Overfilled', tone: 'red' as const }
                    : r.has_low_stock
                        ? { label: 'Low', tone: 'amber' as const }
                        : r.is_stale
                            ? { label: 'Stale', tone: 'amber' as const }
                            : { label: 'OK', tone: 'emerald' as const };
            return {
                title: r.barcode || r.name || `Bin ${r.id}`,
                subtitle: [r.room, r.zone_letter].filter(Boolean).join(' · ') || r.name,
                meta: `${r.total_qty} qty · ${r.sku_count} SKUs · fill ${fill}`,
                badge,
                copyText: r.barcode || r.name || String(r.id),
            };
        }
        case 'sku': {
            const r = row.row;
            const badge = r.stock <= 0
                ? { label: 'OOS', tone: 'red' as const }
                : r.stock <= 5
                    ? { label: 'Low', tone: 'amber' as const }
                    : { label: 'In Stock', tone: 'emerald' as const };
            return {
                title: r.sku,
                subtitle: r.product_title || '—',
                meta: `${r.stock} stock · ${r.bin_count} bin${r.bin_count !== 1 ? 's' : ''} · ${r.total_qty} on shelf`,
                badge,
                copyText: r.sku,
            };
        }
        case 'unit': {
            const r = row.row;
            const tone: 'gray' | 'emerald' | 'amber' | 'red' | 'blue' =
                r.current_status === 'SHIPPED' ? 'gray' :
                r.current_status === 'ON_HOLD' ? 'amber' :
                r.current_status === 'STOCKED' ? 'emerald' :
                r.current_status === 'ALLOCATED' || r.current_status === 'PICKED' ? 'blue' : 'gray';
            return {
                title: r.serial_number || `Unit ${r.id}`,
                subtitle: [r.sku, r.product_title].filter(Boolean).join(' · ') || '—',
                meta: [r.current_location, r.condition_grade].filter(Boolean).join(' · ') || '—',
                badge: { label: r.current_status.replace(/_/g, ' '), tone },
                copyText: r.serial_number || String(r.id),
            };
        }
        case 'event': {
            const r = row.row;
            return {
                title: r.event_type.replace(/_/g, ' '),
                subtitle: [r.sku, r.serial_number, r.bin_name].filter(Boolean).join(' · ') || (r.notes ?? '—'),
                meta: [r.actor_name, new Date(r.occurred_at).toLocaleString()].filter(Boolean).join(' · '),
                badge: r.next_status
                    ? { label: r.next_status.replace(/_/g, ' '), tone: 'blue' as const }
                    : null,
                copyText: `${r.event_type} ${r.sku ?? ''} ${r.serial_number ?? ''}`.trim(),
            };
        }
        case 'alert': {
            const r = row.row;
            const tone: 'gray' | 'emerald' | 'amber' | 'red' = r.resolved_at ? 'gray' : r.severity === 'critical' ? 'red' : 'amber';
            return {
                title: r.rule,
                subtitle: [r.sku, r.bin_barcode].filter(Boolean).join(' · ') || '—',
                meta: new Date(r.raised_at).toLocaleString(),
                badge: { label: r.resolved_at ? 'Resolved' : r.severity, tone },
                copyText: `${r.rule} ${r.sku ?? ''} ${r.bin_barcode ?? ''}`.trim(),
            };
        }
        case 'count': {
            const r = row.row;
            const tone: 'gray' | 'emerald' | 'amber' | 'blue' =
                r.status === 'closed' ? 'gray' :
                r.status === 'in_progress' ? 'blue' :
                r.status === 'reconciling' ? 'amber' :
                'emerald';
            const pct = r.progress_pct != null ? `${Math.round(r.progress_pct * 100)}%` : '—';
            return {
                title: r.name,
                subtitle: [r.zone, `${r.line_count} lines`].filter(Boolean).join(' · '),
                meta: `Progress ${pct}`,
                badge: { label: r.status.replace(/_/g, ' '), tone },
                copyText: r.name,
            };
        }
        case 'triage': {
            const r = row.row;
            const tone = r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'amber' : 'blue';
            return {
                title: r.sku,
                subtitle: r.title,
                meta: `${r.id} · ${r.reporter} · ${r.date}`,
                badge: { label: r.type, tone: tone as any },
                copyText: r.id,
            };
        }
    }
}

export function InventoryResultCard({
    row,
    isActive,
    onClick,
    onCopy,
    copied,
}: InventoryResultCardProps) {
    const body = renderBody(row);

    return (
        <div className="relative group/card">
            {/* ds-raw-button: text-left master-detail picker row, not a DS Button */}
            <button
                type="button"
                onClick={onClick}
                className={[
                    'ds-raw-button w-full text-left p-3 rounded-xl border transition-all group',
                    isActive
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50',
                ].join(' ')}
            >
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`${sectionLabel} text-gray-900 group-hover:text-blue-600 truncate pr-8`}>
                            {body.title}
                        </span>
                        {body.badge ? (
                            <span className={`${microBadge} px-1.5 py-0.5 rounded ${statusBadgeClass(body.badge.tone)}`}>
                                {body.badge.label}
                            </span>
                        ) : null}
                    </div>
                    <p className="text-eyebrow text-gray-500 font-semibold truncate">{body.subtitle}</p>
                    <p className={`${microBadge} font-mono text-gray-500 truncate`}>{body.meta}</p>
                </div>
            </button>
            <HoverTooltip label="Copy identifier" asChild>
                <IconButton
                    onClick={(e) => {
                        e.stopPropagation();
                        onCopy(body.copyText);
                    }}
                    ariaLabel="Copy identifier"
                    tone="accent"
                    icon={copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    className={[
                        'absolute top-2 left-2 p-1.5 rounded-lg border transition-all z-10 flex items-center justify-center',
                        copied
                            ? 'bg-emerald-50 border-emerald-200'
                            : 'bg-white border-gray-100 hover:border-blue-200 opacity-0 group-hover/card:opacity-100 shadow-sm',
                    ].join(' ')}
                />
            </HoverTooltip>
        </div>
    );
}
