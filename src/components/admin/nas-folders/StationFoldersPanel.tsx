import { nasConfigured } from '@/lib/nas-photos';
import { Button } from '@/design-system/primitives';
import { STATIONS } from './nas-folders-config';
import type { StationNasFoldersController } from './useStationNasFolders';

/** Per-station picker default-folder panel. */
export function StationFoldersPanel({ c }: { c: StationNasFoldersController }) {
  const { draft, setFolder, dirty, save, isLoading, setPicking } = c;
  return (
    <>
      <div className="divide-y divide-border-hairline overflow-hidden rounded-2xl border border-border-soft bg-surface-card">
        {STATIONS.map((s) => (
          <div key={s.key} className="flex items-center gap-3 px-4 py-3">
            <div className="w-36 shrink-0">
              <p className="text-label font-black text-text-default">{s.label}</p>
              <p className="text-micro font-bold uppercase tracking-widest text-text-faint">{s.key}</p>
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={draft[s.key] ?? ''}
                onChange={(e) => setFolder(s.key, e.target.value)}
                placeholder="Root (no folder)"
                className="w-full rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-caption text-text-default placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              {s.hint ? <p className="mt-1 text-micro text-text-faint">{s.hint}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {nasConfigured() ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => setPicking(s.key)}>
                  Browse
                </Button>
              ) : null}
              {draft[s.key] ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => setFolder(s.key, '')}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {dirty ? <span className="text-micro font-bold uppercase tracking-widest text-amber-600">Unsaved changes</span> : null}
        <Button
          variant="primary"
          size="md"
          type="button"
          disabled={!dirty || save.isPending || isLoading}
          onClick={() => save.mutate(draft)}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}
