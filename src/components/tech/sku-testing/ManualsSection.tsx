import { useCallback, useState } from 'react';
import { ExternalLink, FileText, Plus, Printer, Unlink } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { unpairManual } from './sku-testing-api';
import { EYEBROW, SECTION, type Bundle } from './sku-testing-types';
import { ManualPicker } from './ManualPicker';

/** Paired SKU manuals — open/print, unpair, and pair a new one from the library. */
export function ManualsSection({
  receivingLineId,
  bundle,
  onChanged,
}: {
  receivingLineId: number;
  bundle: Bundle;
  onChanged: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState(false);
  const manuals = bundle.manuals;

  const unpair = useCallback(
    async (manualId: number) => {
      try {
        await unpairManual(receivingLineId, manualId);
        await onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not unpair manual');
      }
    },
    [receivingLineId, onChanged],
  );

  return (
    <section className={SECTION}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={EYEBROW}>Manuals</h3>
        <button
          type="button"
          onClick={() => setPairing((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors duration-150 hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> Pair
        </button>
      </div>

      {pairing ? (
        <ManualPicker
          receivingLineId={receivingLineId}
          onPaired={async () => {
            setPairing(false);
            await onChanged();
          }}
        />
      ) : null}

      {manuals.length === 0 ? (
        <p className="text-caption text-gray-400">No manuals paired to this SKU yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {manuals.map((m) => {
            const name = m.display_name || m.file_name || `Manual #${m.id}`;
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2">
                {m.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-gray-200" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-gray-900">{name}</span>
                  {m.type ? (
                    <span className="block text-micro font-medium uppercase tracking-wide text-gray-400">{m.type}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {m.source_url ? (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                      title="Open / print manual"
                    >
                      <Printer className="h-4 w-4" />
                    </a>
                  ) : null}
                  {m.source_url ? (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void unpair(m.id)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Unpair manual"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
