import { nasConfigured } from '@/lib/nas-photos';
import { TARGETS } from './nas-folders-config';
import type { StationNasFoldersController } from './useStationNasFolders';

/** Workflow folders panel — Synology root paths + active subfolders per workflow. */
export function NasWorkflowsPanel({ c }: { c: StationNasFoldersController }) {
  const { targets, setTarget, targetsDirty, saveTargets, isLoading, setPicking } = c;
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div>
        <p className="text-label font-black text-gray-800">Workflow folders</p>
        <p className="mt-0.5 text-micro text-gray-400">
          Synology mount paths on the office Mac and active subfolders for receiving photos, outbound
          labels, and claim archives. Root paths here replace <code className="font-mono">NAS_ROOT_*</code> in{' '}
          <code className="font-mono">.env</code> — saving updates the live office agent when{' '}
          <code className="font-mono">NAS_AGENT_URL</code> is set on Vercel.
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {TARGETS.map((target) => (
          <div key={target.key} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[8.5rem_1fr]">
            <div>
              <p className="text-label font-black text-gray-800">{target.label}</p>
              <p className="text-micro font-bold uppercase tracking-widest text-gray-400">{target.key}</p>
            </div>
            <div className="grid gap-2">
              <input
                type="text"
                value={targets[target.key].root}
                onChange={(e) => setTarget(target.key, 'root', e.target.value)}
                placeholder={target.rootPlaceholder}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targets[target.key].folder}
                  onChange={(e) => setTarget(target.key, 'folder', e.target.value)}
                  placeholder={target.folderPlaceholder}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                {target.key !== 'claims' && nasConfigured() ? (
                  <button
                    type="button"
                    onClick={() => setPicking(`target:${target.key}`)}
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
                  >
                    Browse
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {targetsDirty ? <span className="text-micro font-bold uppercase tracking-widest text-amber-600">Unsaved changes</span> : null}
        <button
          type="button"
          disabled={!targetsDirty || saveTargets.isPending || isLoading}
          onClick={() => saveTargets.mutate(targets)}
          className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saveTargets.isPending ? 'Saving…' : 'Save folders'}
        </button>
      </div>
    </div>
  );
}
