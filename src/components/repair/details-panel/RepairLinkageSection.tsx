'use client';

import type { RepairDetailsController } from './useRepairDetailsPanel';

/** Manual pairing editor — order / inbound tracking / serial / catalog SKU. */
export function RepairLinkageSection({ c }: { c: RepairDetailsController }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
        <h3 className="text-micro font-black uppercase tracking-wider text-gray-500">
          Linkage
        </h3>
        {c.hasAnyLink && (
          <button
            type="button"
            onClick={c.handleClearLinks}
            disabled={c.savingLink}
            className="text-eyebrow font-black uppercase tracking-widest text-rose-600 hover:text-rose-800 disabled:opacity-40"
            title="Unlink — clear all linkage fields (reversible)"
          >
            Unlink All
          </button>
        )}
      </div>
      <div className="space-y-3">
        {[
          { label: 'Order #', value: c.linkOrderId, set: c.setLinkOrderId, placeholder: 'Source order id' },
          { label: 'Inbound Tracking', value: c.linkTracking, set: c.setLinkTracking, placeholder: 'Tracking number' },
          { label: 'Serial', value: c.linkSerial, set: c.setLinkSerial, placeholder: 'Unit serial number' },
          { label: 'Catalog SKU', value: c.linkSku, set: c.setLinkSku, placeholder: 'Source SKU' },
        ].map((f) => (
          <div key={f.label}>
            <span className="text-xs text-gray-500 font-semibold block mb-1">{f.label}</span>
            <input
              type="text"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              disabled={c.savingLink}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={c.handleSaveLinks}
          disabled={!c.linksDirty || c.savingLink}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-black uppercase tracking-wider transition-all hover:bg-blue-100 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {c.savingLink ? 'Saving…' : 'Save Links'}
        </button>
      </div>
    </section>
  );
}
