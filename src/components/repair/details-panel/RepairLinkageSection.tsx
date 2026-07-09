'use client';

import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { RepairOrderLinkSearch } from './RepairOrderLinkSearch';
import type { RepairDetailsController } from './useRepairDetailsPanel';

/** Manual pairing editor — order / inbound tracking / serial / catalog SKU. */
export function RepairLinkageSection({ c }: { c: RepairDetailsController }) {
  return (
    <section>
      <div className="flex items-center justify-end mb-3">
        {c.hasAnyLink && (
          <HoverTooltip label="Unlink — clear all linkage fields (reversible)" asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={c.handleClearLinks}
              disabled={c.savingLink}
              className="h-auto px-0 text-eyebrow font-black uppercase tracking-widest text-rose-600 hover:bg-transparent hover:text-rose-700"
            >
              Unlink All
            </Button>
          </HoverTooltip>
        )}
      </div>
      <div className="space-y-3">
        {/* Order # — live Ecwid order lookup (shipped + unshipped), not a raw
            text field. Resolves the real order number before save. */}
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Order #</span>
          <RepairOrderLinkSearch
            value={c.linkOrderId}
            onChange={c.setLinkOrderId}
            disabled={c.savingLink}
          />
        </div>
        {[
          { label: 'Inbound Tracking', value: c.linkTracking, set: c.setLinkTracking, placeholder: 'Tracking number' },
          { label: 'Serial', value: c.linkSerial, set: c.setLinkSerial, placeholder: 'Unit serial number' },
          { label: 'Catalog SKU', value: c.linkSku, set: c.setLinkSku, placeholder: 'Source SKU' },
        ].map((f) => (
          <div key={f.label}>
            <span className="text-xs text-text-soft font-semibold block mb-1">{f.label}</span>
            <input
              type="text"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              disabled={c.savingLink}
              className="w-full px-3 py-2 border border-border-soft rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
            />
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={c.handleSaveLinks}
          disabled={!c.linksDirty || c.savingLink}
          className="w-full border border-blue-200 bg-blue-50 text-blue-700 ring-0 text-sm font-black uppercase tracking-wider hover:border-blue-300 hover:bg-blue-100"
        >
          {c.savingLink ? 'Saving…' : 'Save Links'}
        </Button>
      </div>
    </section>
  );
}
