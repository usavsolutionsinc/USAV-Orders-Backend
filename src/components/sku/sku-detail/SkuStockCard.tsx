import { Minus, Plus } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { SkuDetailData } from './sku-detail-types';
import type { SkuDetailController } from './useSkuDetailView';

/** Stock quantity card — quick +/- adjust, bulk delta, or set-exact mode. */
export function SkuStockCard({ c, data }: { c: SkuDetailController; data: SkuDetailData }) {
  return (
    <div className="rounded-xl bg-surface-card border border-border-soft p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className={sectionLabel}>Stock Quantity</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => c.setShowSetMode(!c.showSetMode)}
          className="text-micro font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
        >
          {c.showSetMode ? 'Quick Adjust' : 'Set Exact'}
        </Button>
      </div>

      {c.error && <p className="mb-2 text-xs font-bold text-red-500">{c.error}</p>}

      {c.showSetMode ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            value={c.absoluteQty}
            onChange={(e) => c.setAbsoluteQty(e.target.value)}
            placeholder={String(data.stock.qty)}
            className="h-10 w-24 rounded-lg border border-border-default px-3 text-center text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <Button
            variant="primary"
            size="lg"
            onClick={c.handleSetAbsolute}
            disabled={c.saving || !c.absoluteQty}
          >
            {c.saving ? 'Saving...' : 'Set'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-surface-sunken p-1">
            <IconButton
              icon={<Minus className="h-4 w-4" />}
              ariaLabel="Decrease stock"
              onClick={() => c.handleAdjust(-1)}
              disabled={c.saving}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-card text-red-600 shadow-sm hover:bg-red-50 transition-colors"
            />
            <div className="w-16 text-center">
              <span className="text-2xl font-black text-text-default">{data.stock.qty}</span>
            </div>
            <IconButton
              icon={<Plus className="h-4 w-4" />}
              ariaLabel="Increase stock"
              onClick={() => c.handleAdjust(1)}
              disabled={c.saving}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-card text-emerald-600 shadow-sm hover:bg-emerald-50 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1">
            <input
              type="number"
              value={c.adjustDelta || ''}
              onChange={(e) => c.setAdjustDelta(parseInt(e.target.value, 10) || 0)}
              placeholder="±"
              className="h-10 w-16 rounded-lg border border-border-default px-2 text-center text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <Button
              variant="brand"
              size="lg"
              onClick={() => c.adjustDelta !== 0 && c.handleAdjust(c.adjustDelta)}
              disabled={c.saving || c.adjustDelta === 0}
            >
              Apply
            </Button>
          </div>

          <select
            value={c.adjustReason}
            onChange={(e) => c.setAdjustReason(e.target.value)}
            className="h-10 rounded-lg border border-border-default px-2 text-xs font-bold text-text-muted focus:border-blue-500"
          >
            {c.reasonOptions.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
