import { useCallback, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { ensureCatalog } from './sku-testing-api';

/** Amber prompt to create a SKU catalog entry when the line has none. */
export function NoCatalogNotice({
  receivingLineId,
  sku,
  onCreated,
}: {
  receivingLineId: number;
  sku: string;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const create = useCallback(async () => {
    setBusy(true);
    try {
      await ensureCatalog(receivingLineId);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create catalog entry');
    } finally {
      setBusy(false);
    }
  }, [receivingLineId, onCreated]);

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
      <span className="text-caption font-medium text-amber-800">
        No catalog entry for {sku || 'this SKU'} yet.
      </span>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create entry'}
      </button>
    </div>
  );
}
