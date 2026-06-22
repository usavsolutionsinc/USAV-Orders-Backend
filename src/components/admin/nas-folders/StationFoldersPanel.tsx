import { nasConfigured } from '@/lib/nas-photos';
import { STATIONS } from './nas-folders-config';
import type { StationNasFoldersController } from './useStationNasFolders';

/** Per-station picker default-folder panel. */
export function StationFoldersPanel({ c }: { c: StationNasFoldersController }) {
  const { draft, setFolder, dirty, save, isLoading, setPicking } = c;
  return (
    <>
      <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {STATIONS.map((s) => (
          <div key={s.key} className="flex items-center gap-3 px-4 py-3">
            <div className="w-36 shrink-0">
              <p className="text-label font-black text-gray-800">{s.label}</p>
              <p className="text-micro font-bold uppercase tracking-widest text-gray-400">{s.key}</p>
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={draft[s.key] ?? ''}
                onChange={(e) => setFolder(s.key, e.target.value)}
                placeholder="Root (no folder)"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              {s.hint ? <p className="mt-1 text-micro text-gray-400">{s.hint}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {nasConfigured() ? (
                <button
                  type="button"
                  onClick={() => setPicking(s.key)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
                >
                  Browse
                </button>
              ) : null}
              {draft[s.key] ? (
                <button
                  type="button"
                  onClick={() => setFolder(s.key, '')}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-micro font-black uppercase tracking-widest text-gray-500 hover:bg-gray-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {dirty ? <span className="text-micro font-bold uppercase tracking-widest text-amber-600">Unsaved changes</span> : null}
        <button
          type="button"
          disabled={!dirty || save.isPending || isLoading}
          onClick={() => save.mutate(draft)}
          className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}
