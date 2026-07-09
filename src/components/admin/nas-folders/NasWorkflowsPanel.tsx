import { nasConfigured } from '@/lib/nas-photos';
import { Button } from '@/design-system/primitives';
import { TARGETS } from './nas-folders-config';
import type { StationNasFoldersController } from './useStationNasFolders';

/** Workflow folders panel — Synology root paths + active subfolders per workflow. */
export function NasWorkflowsPanel({ c }: { c: StationNasFoldersController }) {
  const { targets, setTarget, targetsDirty, saveTargets, isLoading, setPicking } = c;
  return (
    <div className="space-y-3 rounded-2xl border border-border-soft bg-surface-card p-4">
      <div>
        <p className="text-label font-black text-text-default">Workflow folders</p>
        <p className="mt-0.5 text-micro text-text-faint">
          Synology mount paths on the office Mac and active subfolders for receiving photos, outbound
          labels, and claim archives. Root paths here replace <code className="font-mono">NAS_ROOT_*</code> in{' '}
          <code className="font-mono">.env</code> — saving updates the live office agent when{' '}
          <code className="font-mono">NAS_AGENT_URL</code> is set on Vercel.
        </p>
      </div>

      <div className="divide-y divide-border-hairline">
        {TARGETS.map((target) => (
          <div key={target.key} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[8.5rem_1fr]">
            <div>
              <p className="text-label font-black text-text-default">{target.label}</p>
              <p className="text-micro font-bold uppercase tracking-widest text-text-faint">{target.key}</p>
            </div>
            <div className="grid gap-2">
              <input
                type="text"
                value={targets[target.key].root}
                onChange={(e) => setTarget(target.key, 'root', e.target.value)}
                placeholder={target.rootPlaceholder}
                className="w-full rounded-lg border border-border-soft bg-surface-card px-3 py-2 font-mono text-caption text-text-default placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targets[target.key].folder}
                  onChange={(e) => setTarget(target.key, 'folder', e.target.value)}
                  placeholder={target.folderPlaceholder}
                  className="min-w-0 flex-1 rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-caption text-text-default placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                {target.key !== 'claims' && nasConfigured() ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPicking(`target:${target.key}`)}
                    className="shrink-0"
                  >
                    Browse
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {targetsDirty ? <span className="text-micro font-bold uppercase tracking-widest text-amber-600">Unsaved changes</span> : null}
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!targetsDirty || saveTargets.isPending || isLoading}
          onClick={() => saveTargets.mutate(targets)}
        >
          {saveTargets.isPending ? 'Saving…' : 'Save folders'}
        </Button>
      </div>
    </div>
  );
}
