import { useCallback, useState } from 'react';
import { Link2, Loader2, Plus } from '@/components/Icons';
import { TextField } from '@/design-system/primitives/TextField';
import { platformStyle } from '../platform-style';
import { manualAddPairing } from './sku-pair-api';
import { PasteButton } from './PasteButton';

/**
 * Inline "add an identifier to THIS platform" control, shown on every channel
 * row (including empty ones). Hand-enter an item number and/or SKU and link it —
 * posts a single manual accept to the atomic + audited pair-batch path, then
 * refreshes the hub.
 */
export function ChannelManualAdd({
  platform,
  skuCatalogId,
  onAdded,
}: {
  platform: string;
  skuCatalogId: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [itemNumber, setItemNumber] = useState('');
  const [sku, setSku] = useState('');
  const [account, setAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setItemNumber('');
    setSku('');
    setAccount('');
    setError(null);
    setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    const trimmedItem = itemNumber.trim();
    const trimmedSku = sku.trim();
    if (!trimmedItem && !trimmedSku) {
      setError('Enter an item number or SKU');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await manualAddPairing(skuCatalogId, {
        platform,
        platformItemId: trimmedItem || null,
        platformSku: trimmedSku || null,
        accountName: account.trim() || null,
      });
      close();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }, [account, close, itemNumber, onAdded, platform, sku, skuCatalogId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-eyebrow font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-blue-600"
      >
        <Plus className="h-3 w-3" /> Add {platformStyle(platform).label} identifier
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
      <TextField label="Item number" value={itemNumber} onChange={setItemNumber} mono trailing={<PasteButton onPaste={setItemNumber} />} />
      <TextField label="SKU" value={sku} onChange={setSku} mono trailing={<PasteButton onPaste={setSku} />} />
      <TextField label="Account (optional)" value={account} onChange={setAccount} />
      {error ? <p className="text-micro font-semibold text-red-600">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-2.5 py-1.5 text-micro font-bold uppercase tracking-wider text-gray-500 transition-colors hover:bg-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || (!itemNumber.trim() && !sku.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-micro font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}
