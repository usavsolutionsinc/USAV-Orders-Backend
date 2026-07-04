'use client';

/**
 * Isolated showroom for the identity-chip tracking column — empty ("+ TRK#")
 * vs filled (TrackingChip) states laid out through ReceivingIdentityChips /
 * ChipColumns, exactly as the Incoming receiving rows render them. No DB/auth:
 * pure fixture props, so it can be Playwright-screenshotted for visual review
 * (same pattern as /design-demo/photo-peek).
 */

import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { AddValueChipFace } from '@/components/ui/CopyChip';
import { Link2 } from '@/components/Icons';

// Mirrors IncomingAttachTrackingButton's real face (chain icon + size="chip").
const addTrkFace = (
  <button type="button" className="ds-raw-button inline-flex shrink-0 items-center px-1.5 transition-colors">
    <AddValueChipFace label="+ TRK#" icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} size="chip" />
  </button>
);

const ROWS = [
  { po: 'PO-12340', sku: 'SKU-6BK', tracking: '', note: 'empty' },
  { po: 'PO-12341', sku: 'SKU-001', tracking: '9400111899223457568', note: 'filled' },
  { po: 'PO-12342', sku: 'SKU-002', tracking: '', note: 'empty' },
  { po: 'PO-12343', sku: 'SKU-003', tracking: '9400111899223457404', note: 'filled' },
  { po: 'PO-12344', sku: 'SKU-004', tracking: '9400111899223453187', note: 'filled' },
];

export default function IdChipsDemoPage() {
  return (
    <div className="min-h-screen bg-surface-card p-10" data-testid="id-chips-demo">
      <h1 className="mb-4 text-eyebrow font-black uppercase tracking-widest text-text-soft">
        ID chips — tracking column (empty vs filled), final
      </h1>
      <div className="w-[520px] divide-y divide-border-hairline rounded-xl border border-border-soft">
        {ROWS.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-1.5">
            <span className="text-eyebrow uppercase tracking-widest text-text-faint">{r.note}</span>
            <ReceivingIdentityChips
              po={r.po}
              sku={r.sku}
              tracking={r.tracking}
              includeSerial={false}
              asColumns
              trackingAction={addTrkFace}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
