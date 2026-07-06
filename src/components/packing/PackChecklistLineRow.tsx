'use client';

import Image from 'next/image';
import { Check, ChevronDown, Package } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { InlineNotice } from '@/design-system/components';
import type { PackChecklistLineDto, PackKitPartDto, PackCheckDto } from '@/lib/packing/order-pack-checklist';

interface PackChecklistLineRowProps {
  line: PackChecklistLineDto;
  checked: boolean;
  expanded: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  tickedKitParts: ReadonlySet<number>;
  onToggleKitPart: (partId: number) => void;
  tickedChecks: ReadonlySet<number>;
  onToggleCheckItem: (checkId: number) => void;
  variant: 'station' | 'mobile' | 'panel';
}

const PART_TYPE_TAG: Record<string, string> = {
  ACCESSORY: 'Accessory',
  CABLE: 'Cable',
  MANUAL: 'Manual',
  ADAPTER: 'Adapter',
};

function SubCheckRow({
  checked,
  onToggle,
  label,
  qty,
  tag,
  critical,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  qty?: number;
  tag?: string;
  critical?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        className={`ds-raw-button flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
          checked
            ? 'border-emerald-200 bg-emerald-50'
            : critical
              ? 'border-amber-200 bg-surface-card hover:bg-amber-50'
              : 'border-border-soft bg-surface-card hover:bg-surface-hover'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            checked
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-border-default bg-surface-card'
          }`}
        >
          {checked && <Check className="h-2.5 w-2.5" />}
        </span>
        <span className={`flex-1 text-mini font-bold ${checked ? 'text-emerald-700 line-through' : 'text-text-default'}`}>
          {label}
        </span>
        {qty && qty > 1 ? (
          <span className="text-eyebrow font-black tabular-nums text-text-soft">×{qty}</span>
        ) : null}
        {tag ? (
          <span className="rounded-md bg-surface-sunken px-1 py-0.5 text-eyebrow font-bold uppercase text-text-soft">
            {tag}
          </span>
        ) : null}
        {critical && !checked ? (
          <span className="rounded-md bg-amber-100 px-1 py-0.5 text-eyebrow font-black uppercase text-amber-700">
            Required
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function PackChecklistLineRow({
  line,
  checked,
  expanded,
  onToggleCheck,
  onToggleExpand,
  tickedKitParts,
  onToggleKitPart,
  tickedChecks,
  onToggleCheckItem,
  variant,
}: PackChecklistLineRowProps & { onToggleCheckItem: (checkId: number) => void }) {
  const condLabel = line.condition?.trim() || 'N/A';
  const sku = line.sku?.trim() ?? '';
  const touchClass = variant === 'mobile' ? 'min-h-[44px]' : '';

  return (
    <li className="border-b border-border-hairline last:border-b-0">
      <div className={`flex items-start gap-2 px-3 py-2 ${checked ? 'bg-emerald-50/40' : ''}`}>
        <HoverTooltip label="Confirm this item is in the box" asChild>
          <button
            type="button"
            onClick={onToggleCheck}
            aria-pressed={checked}
            aria-label="Confirm line item"
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${touchClass} ${
              checked
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-border-default bg-surface-card hover:border-emerald-400'
            }`}
          >
            {checked && <Check className="h-3 w-3" />}
          </button>
        </HoverTooltip>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className={`ds-raw-button min-w-0 flex-1 text-left ${touchClass}`}
        >
          <div className="flex items-start gap-2">
            {/* Prominent SKU catalog photo for visual verification (high-ROI scan match) */}
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border-soft bg-surface-card">
              {line.catalog.imageUrl ? (
                <Image
                  src={line.catalog.imageUrl}
                  alt={line.productTitle}
                  fill
                  className="object-cover"
                  sizes="40px"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-text-faint">
                  <Package className="h-5 w-5 opacity-40" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-label font-bold ${checked ? 'text-emerald-700 line-through' : 'text-text-default'}`}>
                {line.productTitle}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
                  ×{line.quantity}
                  <span className="px-1 text-text-faint">·</span>
                  {condLabel}
                </span>
                {sku ? <SkuScanRefChip value={sku} display={getLast4(sku)} /> : null}
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-soft transition-transform hover:bg-surface-sunken ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-border-hairline bg-surface-canvas/60 px-3 py-3">
          {/* Larger photo + visual verification emphasis (top priority: confirm SKU photo matches physical) */}
          <div className="flex gap-3">
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-border-soft bg-surface-card ring-1 ring-inset ring-blue-100">
              {line.catalog.imageUrl ? (
                <Image
                  src={line.catalog.imageUrl}
                  alt={line.productTitle}
                  fill
                  className="object-cover"
                  sizes="112px"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-text-faint">
                  <Package className="h-10 w-10 opacity-40" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-700 ring-1 ring-inset ring-blue-200">
                Visual match — confirm photo = physical item
              </div>
              <dl className="min-w-0 flex-1 space-y-1">
                {line.catalog.category ? (
                  <div>
                    <dt className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Category</dt>
                    <dd className="text-caption font-bold text-text-default">{line.catalog.category}</dd>
                  </div>
                ) : null}
                {line.catalog.upc ? (
                  <div>
                    <dt className="text-eyebrow font-black uppercase tracking-widest text-text-faint">UPC</dt>
                    <dd className="font-mono text-caption font-bold text-text-muted">{line.catalog.upc}</dd>
                  </div>
                ) : null}
                {line.serials.length > 0 ? (
                  <div>
                    <dt className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Serials</dt>
                    <dd className="font-mono text-mini font-bold text-text-default">{line.serials.join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>

          {line.catalog.packNotes ? (
            <InlineNotice tone="info" size="sm" title="How to pack">
              {line.catalog.packNotes}
            </InlineNotice>
          ) : null}

          {line.kitParts.length > 0 ? (
            <div>
              <p className="mb-1.5 text-eyebrow font-black uppercase tracking-wider text-text-faint">In the box</p>
              <ul className="space-y-1">
                {line.kitParts.map((part: PackKitPartDto) => (
                  <SubCheckRow
                    key={part.id}
                    checked={tickedKitParts.has(part.id)}
                    onToggle={() => onToggleKitPart(part.id)}
                    label={part.name}
                    qty={part.qty > 1 ? part.qty : undefined}
                    tag={PART_TYPE_TAG[part.type]}
                    critical={part.critical}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {line.qcFlags.length > 0 ? (
            <div>
              <p className="mb-1.5 text-eyebrow font-black uppercase tracking-wider text-text-faint">
                Verify before sealing
              </p>
              <ul className="space-y-1">
                {line.qcFlags.map((check: PackCheckDto) => (
                  <SubCheckRow
                    key={check.id}
                    checked={tickedChecks.has(check.id)}
                    onToggle={() => onToggleCheckItem(check.id)}
                    label={check.label}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
