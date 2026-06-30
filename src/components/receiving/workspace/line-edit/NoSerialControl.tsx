'use client';

import { useRef, useState, type ComponentType } from 'react';
import { AlertTriangle, Barcode, Boxes, Check, Tag, X } from '@/components/Icons';
import { Popover } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useReasonVocabulary } from '@/hooks/useReasonVocabulary';
import {
  SERIAL_ABSENT_REASON_FLOW,
  mergeSerialAbsentReasons,
  serialAbsentReasonLabel,
  type SerialAbsentReasonMeta,
  type SerialAbsentSeverity,
} from '@/lib/receiving/serial-absent-reasons';

export interface SerialAbsentState {
  absent: boolean;
  reason: string | null;
}

interface Props {
  absent: boolean;
  reason: string | null;
  onChange: (next: SerialAbsentState) => void;
  /** When true the org enforces the checkpoint — the offer token reads as a required gate. */
  required?: boolean;
  disabled?: boolean;
  /** 'pill' = single-line offer token; 'check' = all-units offer token (multi-qty line level). */
  variant?: 'pill' | 'check';
  /**
   * Committed state spans the full width of its slot and reads as a labeled bar
   * (leading ✓ + "No serial · {reason}"), instead of the compact inline icon
   * token. Use when this *replaces an input field* (single-qty SerialCard), where
   * the field's current value should fill the field's width.
   */
  fullWidth?: boolean;
}

type Glyph = ComponentType<{ className?: string }>;

/**
 * Each reason maps to a structural glyph; meaning is carried by the HoverTooltip
 * (house rule: contextual info via HoverTooltip, not inline text). Custom org
 * codes fall back to the generic serial glyph.
 */
const REASON_ICON: Record<string, Glyph> = {
  NOT_SERIALIZED: Barcode,
  UNREADABLE: AlertTriangle,
  MISSING_LABEL: Tag,
  BULK: Boxes,
};
const reasonIcon = (code: string | null | undefined): Glyph =>
  (code && REASON_ICON[code]) || Barcode;

/**
 * Tone follows the documented chip convention (bg-x-50 / text-x-700 / ring-x-200)
 * and is keyed off the reason's *severity*, so a routine waiver (cable, bulk)
 * reads calm slate and a genuine anomaly (unreadable, missing label) reads amber.
 */
const TONE: Record<
  SerialAbsentSeverity,
  { token: string; icon: string; clear: string; rowSel: string; tick: string }
> = {
  routine: {
    token: 'bg-slate-50 text-slate-700 ring-slate-200',
    icon: 'text-slate-500',
    clear: 'text-slate-400 hover:bg-slate-200 hover:text-slate-600',
    rowSel: 'bg-slate-50 text-slate-800',
    tick: 'text-slate-500',
  },
  anomaly: {
    token: 'bg-amber-50 text-amber-800 ring-amber-200',
    icon: 'text-amber-600',
    clear: 'text-amber-500 hover:bg-amber-100 hover:text-amber-700',
    rowSel: 'bg-amber-50 text-amber-800',
    tick: 'text-amber-600',
  },
};

const severityOf = (
  reasons: readonly SerialAbsentReasonMeta[],
  code: string | null,
): SerialAbsentSeverity =>
  reasons.find((r) => r.code === code)?.severity ?? 'routine';

const ChevronGlyph = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className={`h-3 w-3 opacity-60 ${className}`}
  >
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Explicit "no serial number" waiver for a receive line. The serial input and
 * this control are mutually exclusive: capturing a serial clears the waiver
 * (handled in the controller). Activating it records an auditable reason code
 * (the `serial_absent_reason` Class-D vocabulary) rather than a silent blank — so
 * a cable received with no serial is a first-class fact, not missing data.
 *
 * Display: icon-first, tooltip-driven. The *presence* of the token = committed;
 * the *icon* = which reason; the *tone* = how exceptional it is. No inline label
 * text — the operator reads the glyph and confirms via the HoverTooltip.
 */
export function NoSerialControl({
  absent,
  reason,
  onChange,
  required = false,
  disabled = false,
  variant = 'pill',
  fullWidth = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Anchored to the whole token (not just the trigger button) so `matchWidth`
  // sizes the dropdown to the full component width.
  const anchorRef = useRef<HTMLDivElement>(null);
  const dbRows = useReasonVocabulary(SERIAL_ABSENT_REASON_FLOW);
  const reasons = mergeSerialAbsentReasons(dbRows);

  const activate = () => {
    if (disabled) return;
    const first = reasons[0]?.code ?? 'NOT_SERIALIZED';
    onChange({ absent: true, reason: reason ?? first });
    // Icon-only trigger → make the first pick explicit by opening the picker.
    setPickerOpen(true);
  };
  const clear = () => {
    onChange({ absent: false, reason: null });
    setPickerOpen(false);
  };
  const pick = (code: string) => {
    onChange({ absent: true, reason: code });
    setPickerOpen(false);
  };

  // ── Offer state: no waiver yet — a single dashed icon token that invites it.
  if (!absent) {
    const offerLabel =
      variant === 'check'
        ? 'No serial number for all units (same SKU, no serials available)'
        : 'Mark this item as having no serial number — cables, accessories, bulk parts';
    return (
      <HoverTooltip label={required ? `Required — ${offerLabel}` : offerLabel} asChild>
        {/* ds-raw-button: bespoke dashed icon token, not a DS Button variant */}
        <button
          type="button"
          onClick={activate}
          disabled={disabled}
          aria-label={offerLabel}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-dashed px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            required
              ? 'border-amber-300 text-amber-600 hover:bg-amber-50 hover:text-amber-700'
              : 'border-gray-300 text-gray-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600'
          }`}
        >
          <Barcode className="h-4 w-4" />
          <ChevronGlyph />
        </button>
      </HoverTooltip>
    );
  }

  // ── Committed state: an icon token carrying the chosen reason + a clear affordance.
  const sev = severityOf(reasons, reason);
  const tone = TONE[sev];
  const Icon = reasonIcon(reason);
  const label = serialAbsentReasonLabel(reason);
  const hint = reasons.find((r) => r.code === reason)?.hint;

  // Full-width committed bar reads as a "confirmed no serial" field value: a green
  // check (the affirmation), no inline label (the reason lives in the tooltip +
  // dropdown), on a calm neutral bar so the check is the only color. The compact
  // (multi-qty) token keeps the reason icon + severity tone.
  const containerTone = fullWidth ? 'bg-gray-50 text-gray-500 ring-gray-200' : tone.token;
  const clearTone = fullWidth
    ? 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
    : tone.clear;

  return (
    <>
      <div
        ref={anchorRef}
        className={`${
          fullWidth ? 'flex w-full' : 'inline-flex max-w-full'
        } h-9 items-center rounded-xl pr-1 ring-1 ring-inset ${containerTone}`}
      >
        <HoverTooltip
          label={hint ? `No serial · ${label} — ${hint}` : `No serial · ${label}`}
          asChild
          focusable={false}
        >
          {/* ds-raw-button: opens the reason popover. Compact = icon only; full-width
              = reason icon + label, the chevron pushed to the right edge. */}
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            aria-label={`No serial — ${label}. Change reason`}
            className={`${
              fullWidth
                ? 'flex h-full min-w-0 flex-1 items-center gap-2'
                : 'inline-flex h-full items-center gap-1.5 pr-1.5'
            } rounded-l-xl pl-2.5 transition-colors hover:brightness-95 disabled:opacity-50`}
          >
            {fullWidth ? (
              <>
                <Icon className={`h-4 w-4 shrink-0 ${tone.icon}`} />
                <span className="truncate text-label font-semibold text-gray-700">{label}</span>
                <ChevronGlyph className="ml-auto mr-0.5 shrink-0" />
              </>
            ) : (
              <>
                <Icon className={`h-4 w-4 ${tone.icon}`} />
                <ChevronGlyph />
              </>
            )}
          </button>
        </HoverTooltip>
        {/* ds-raw-button: icon token clear affordance */}
        <button
          type="button"
          onClick={clear}
          aria-label="Clear no-serial waiver"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors ${clearTone}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Popover
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={anchorRef}
        placement="bottom-start"
        matchWidth={fullWidth}
        role="menu"
        aria-label="No-serial reason"
        className={fullWidth ? 'p-1' : 'min-w-[208px] p-1'}
      >
        {reasons.map((r) => {
          const selected = r.code === reason;
          const rowTone = TONE[r.severity];
          const RowIcon = reasonIcon(r.code);
          return (
            <HoverTooltip key={r.code} label={r.hint || r.label} asChild focusable={false}>
              {/* ds-raw-button: bespoke reason menu-item row */}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => pick(r.code)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-label font-semibold transition-colors ${
                  selected ? rowTone.rowSel : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <RowIcon className={`h-4 w-4 shrink-0 ${selected ? rowTone.icon : 'text-gray-400'}`} />
                <span className="flex-1 truncate">{r.label}</span>
                {selected ? <Check className={`h-4 w-4 shrink-0 ${rowTone.tick}`} /> : null}
              </button>
            </HoverTooltip>
          );
        })}
      </Popover>
    </>
  );
}
