import { useCallback, useState } from 'react';
import { Link2, Plus, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { PRODUCT_HUB_PLATFORMS, platformStyle } from '../platform-style';
import { manualAddPairing } from './sku-pair-api';

/**
 * Inline "pair a SKU by hand" form. Posts a single inline-create accept entry to
 * the atomic + audited pair-batch path, then refreshes the hub. Used when a
 * platform listing isn't in the ranked suggestions yet.
 */
export function ManualPairForm({ skuCatalogId, onAdded }: { skuCatalogId: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>(PRODUCT_HUB_PLATFORMS[0]);
  const [sku, setSku] = useState('');
  const [account, setAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSku('');
    setAccount('');
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const value = sku.trim();
    if (!value) {
      setError('Enter a SKU or identifier');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await manualAddPairing(skuCatalogId, { platform, platformSku: value, accountName: account.trim() || null });
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add pairing');
    } finally {
      setSaving(false);
    }
  }, [account, onAdded, platform, reset, sku, skuCatalogId]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        icon={<Plus className="h-3.5 w-3.5" />}
        className="mb-3 rounded-md border border-dashed border-border-default text-micro font-bold uppercase tracking-wider text-text-muted hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        Pair a SKU manually
      </Button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-micro font-bold uppercase tracking-wider text-blue-700">Manual pairing</span>
        <IconButton
          onClick={() => {
            reset();
            setOpen(false);
          }}
          ariaLabel="Cancel manual pairing"
          icon={<X className="h-3.5 w-3.5" />}
          className="rounded p-0.5 text-text-faint hover:bg-surface-card hover:text-text-muted"
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-text-soft">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-md border border-border-default bg-surface-card px-2 py-1.5 text-xs font-semibold text-text-default focus:border-blue-400 focus:outline-none"
          >
            {PRODUCT_HUB_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {platformStyle(p).label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-text-soft">SKU / identifier</span>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. 01815"
            className="w-full rounded-md border border-border-default bg-surface-card px-2 py-1.5 font-mono text-xs text-text-default focus:border-blue-400 focus:outline-none"
          />
        </label>
        <label className="flex min-w-[7rem] flex-1 flex-col gap-0.5">
          <span className="text-eyebrow font-semibold uppercase tracking-wider text-text-soft">
            Account <span className="font-normal normal-case text-text-faint">(optional)</span>
          </span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="e.g. DRAGONH"
            className="w-full rounded-md border border-border-default bg-surface-card px-2 py-1.5 text-xs text-text-default focus:border-blue-400 focus:outline-none"
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={saving || !sku.trim()}
          loading={saving}
          icon={<Link2 className="h-3.5 w-3.5" />}
          className="rounded-md text-xs font-bold"
        >
          Pair
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-micro font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}
