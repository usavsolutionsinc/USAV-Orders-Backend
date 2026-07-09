import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import { Button } from '@/design-system/primitives';
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
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        onClick={() => void create()}
        className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
      >
        Create entry
      </Button>
    </div>
  );
}
