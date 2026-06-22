import { useCallback, useEffect, useState } from 'react';
import { listNasDir, type NasEntry } from '@/lib/nas-photos';
import { NasBreadcrumb, NasFolderCard, NasSectionLabel } from '@/components/nas/NasBrowserChrome';
import { Layer } from '@/design-system';

/**
 * Browse the NAS tree and pick a folder. Reuses the same breadcrumb + folder
 * cards as the receiving picker; "Use this folder" returns the current path.
 */
export function FolderPickerModal({
  station,
  initialDir,
  onCancel,
  onPick,
}: {
  station: string;
  initialDir: string;
  onCancel: () => void;
  onPick: (folder: string) => void;
}) {
  const [dir, setDir] = useState(() => (initialDir || '').replace(/^\/+|\/+$/g, ''));
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (relDir: string) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listNasDir(relDir));
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Failed to load folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(dir);
  }, [dir, load]);

  const folders = entries.filter((e) => e.type === 'directory');

  return (
    <Layer level="panelPopover" role="dialog" aria-modal="true" className="fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">Pick folder · {station}</p>
            <p className="truncate text-sm font-bold text-gray-800">/{dir || 'Root'}</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>

        {dir ? (
          <div className="border-b border-gray-100 px-3 py-2">
            <NasBreadcrumb dir={dir} onNavigate={setDir} rootLabel="Root" />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-2xl bg-gray-100" />
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-caption font-bold text-rose-600">{error}</p>
              <button type="button" onClick={() => void load(dir)} className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50">
                Retry
              </button>
            </div>
          ) : folders.length === 0 ? (
            <p className="py-10 text-center text-caption font-bold uppercase tracking-widest text-gray-400">No subfolders here.</p>
          ) : (
            <div className="space-y-1.5">
              <NasSectionLabel>Folders · {folders.length}</NasSectionLabel>
              {folders.map((f) => (
                <NasFolderCard key={f.relPath} name={f.name} onOpen={() => setDir(f.relPath)} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <span className="truncate text-micro font-bold uppercase tracking-widest text-gray-400">
            {dir ? `Selecting: /${dir}` : 'At root — pick a subfolder or use root'}
          </span>
          <button type="button" onClick={() => onPick(dir)} className="inline-flex h-9 shrink-0 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700">
            Use this folder
          </button>
        </div>
      </div>
    </Layer>
  );
}
