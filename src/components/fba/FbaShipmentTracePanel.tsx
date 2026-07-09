'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Barcode, Boxes, ChevronDown, Loader2, MapPin,
} from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { FnskuChip, SerialChip } from '@/components/ui/CopyChip';
import { FbaStatusBadge } from './shared/FbaStatusBadge';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TimelineSection } from '@/components/ui/TimelineSection';
import type { TimelineItem } from '@/lib/timeline/types';

/**
 * FbaShipmentTracePanel — the FBA-specific audit view (P2-FBA-01).
 *
 * Renders the full path for one all-in-one shipment:
 *   shipment → FNSKU line → serialized unit → unit path (timeline)
 *
 * The unit path itself is rendered by the shared {@link TimelineSection} /
 * EventTimeline (consumed read-only — no edits to those shared primitives).
 * This component owns only FBA-specific framing: FNSKU lines, unit chips, and
 * the inconsistency flags surfaced by GET /api/fba/shipments/[id]/trace.
 */

type TraceFlag = {
  code: 'MISSING_UNIT_LINK' | 'NO_PATH' | 'CONDITION_MISMATCH' | 'NO_TRACKING';
  severity: 'warning' | 'danger';
  message: string;
};

type TraceUnit = {
  serial_unit_id: number;
  serial_number: string;
  unit_uid: string | null;
  condition_grade: string | null;
  current_status: string | null;
  current_location: string | null;
  added_by_name: string | null;
  timeline: TimelineItem[];
  flags: TraceFlag[];
};

type TraceItem = {
  item_id: number;
  fnsku: string;
  display_title: string | null;
  catalog_condition: string | null;
  expected_qty: number;
  actual_qty: number;
  status: string;
  units: TraceUnit[];
  flags: TraceFlag[];
};

type TraceResponse = {
  success: boolean;
  error?: string;
  shipment?: {
    id: number;
    amazon_shipment_id: string | null;
    shipment_ref: string;
    status: string;
    destination_fc: string | null;
    tracking_count: number;
  };
  items?: TraceItem[];
  summary?: {
    item_count: number;
    unit_count: number;
    traced_unit_count: number;
    flag_count: number;
  };
  flags?: (TraceFlag & { scope: string })[];
};

function FlagPill({ flag }: { flag: TraceFlag }) {
  const tone =
    flag.severity === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <HoverTooltip label={flag.message} focusable={false} asChild>
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${tone}`}
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        {flag.code.replace(/_/g, ' ')}
      </span>
    </HoverTooltip>
  );
}

function UnitRow({ unit }: { unit: TraceUnit }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border-hairline bg-surface-canvas/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ds-raw-button flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-surface-sunken/60"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Barcode className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <SerialChip value={unit.serial_number} />
          {unit.current_status ? (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider bg-surface-strong text-text-muted">
              {unit.current_status}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {unit.flags.map((f, i) => (
            <FlagPill key={i} flag={f} />
          ))}
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {open ? (
        <div className="border-t border-border-hairline px-2.5 pb-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-micro font-semibold text-text-soft">
            {unit.unit_uid ? <span>UID {unit.unit_uid}</span> : null}
            {unit.condition_grade ? <span>Grade {unit.condition_grade}</span> : null}
            {unit.current_location ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" /> {unit.current_location}
              </span>
            ) : null}
          </div>
          <TimelineSection
            items={unit.timeline}
            title="Unit Path"
            density="compact"
            emptyMessage="No inventory events recorded for this unit."
            className="border-t border-border-hairline pt-3 pb-1"
          />
        </div>
      ) : null}
    </div>
  );
}

function ItemBlock({ item }: { item: TraceItem }) {
  return (
    <section className="py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FnskuChip value={item.fnsku} />
          <FbaStatusBadge status={item.status} size="xs" />
        </div>
        <span className="shrink-0 text-micro font-black tabular-nums text-text-soft">
          {item.actual_qty}/{item.expected_qty}
        </span>
      </div>
      <p className="mb-2 truncate text-caption font-bold text-text-muted">
        {item.display_title || 'No title'}
      </p>

      {item.flags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {item.flags.map((f, i) => (
            <FlagPill key={i} flag={f} />
          ))}
        </div>
      ) : null}

      {item.units.length === 0 ? (
        <p className="py-2 text-center text-caption font-bold text-text-faint">
          No serialized units linked to this FNSKU
        </p>
      ) : (
        <div className="space-y-1.5">
          {item.units.map((u) => (
            <UnitRow key={u.serial_unit_id} unit={u} />
          ))}
        </div>
      )}
    </section>
  );
}

interface FbaShipmentTracePanelProps {
  shipmentId: number;
  className?: string;
}

export function FbaShipmentTracePanel({ shipmentId, className }: FbaShipmentTracePanelProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fba/shipments/${shipmentId}/trace`, { cache: 'no-store' });
      const json = (await res.json()) as TraceResponse;
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load trace');
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load trace');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-6 ${className ?? ''}`}>
        <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-caption font-semibold text-red-700 ${className ?? ''}`}>
        {error}
      </div>
    );
  }

  if (!data?.items) return null;

  const summary = data.summary;
  const shipmentFlags = (data.flags ?? []).filter((f) => f.scope.startsWith('shipment:'));

  return (
    <div className={className}>
      {/* Trace summary band */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={sectionLabel}>Shipment Trace</p>
        {summary ? (
          <span className="flex items-center gap-2 text-micro font-bold text-text-soft">
            <span className="inline-flex items-center gap-1">
              <Boxes className="h-3 w-3" />
              {summary.traced_unit_count}/{summary.unit_count} traced
            </span>
            {summary.flag_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {summary.flag_count}
              </span>
            ) : (
              <span className="text-emerald-600">consistent</span>
            )}
          </span>
        ) : null}
      </div>

      {shipmentFlags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {shipmentFlags.map((f, i) => (
            <FlagPill key={i} flag={f} />
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-border-hairline">
        {data.items.map((item) => (
          <ItemBlock key={item.item_id} item={item} />
        ))}
      </div>
    </div>
  );
}
