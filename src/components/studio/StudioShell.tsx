'use client';

/**
 * StudioShell — the Operations Studio page body: a full-width canvas with a
 * contextual Inspector.
 *
 *   Canvas (React Flow, L0 ⇄ L1 semantic zoom) | Inspector
 *
 * All state lives in StudioWorkspaceContext (mounted in app/layout.tsx) so the
 * master-nav route panel (StudioSidebarPanel) and this body share one source of
 * truth. The View dropdown, node Library and Issues rail live in that panel;
 * this shell keeps only the canvas, the inspector, and the shell-scoped header
 * actions (version switch · draft ▸ publish · in-flight count).
 *
 * View state is URL-persisted so any view is shareable (`?v=&focus=&z=&lens=`).
 * See StudioWorkspaceContext for the data/edit/live mechanics.
 */

import { useLocalStorage } from '@/hooks';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { useStudioWorkspace } from './StudioWorkspaceContext';
import { StudioCanvas } from './StudioCanvas';
import { StudioInspector } from './StudioInspector';
import { StudioStationPreview } from './StudioStationPreview';

export function StudioShell() {
  const {
    graph,
    error,
    nodes,
    edges,
    z,
    lens,
    focus,
    focusedNode,
    diagnostics,
    liveNodes,
    flowEdges,
    live,
    station,
    stationLoading,
    canManage,
    isDraft,
    editing,
    dirty,
    busy,
    actionError,
    setParams,
    onGraphChange,
    onUpdateNodeConfig,
    onDeleteNode,
    createDraft,
    saveDraft,
    publish,
  } = useStudioWorkspace();

  // Inspector is a workspace preference (not shareable view state) → localStorage.
  const [inspectorOpen, setInspectorOpen] = useLocalStorage('studio:inspector-open', true);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      {/* ─── Header: title · version switcher · draft controls · in-flight count ─── */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight text-slate-900">Operations Studio</h1>
          <p className="text-[11px] text-slate-400">
            {editing ? 'Editing a draft — changes go live on publish' : 'Viewing · edits happen on a draft'}
          </p>
        </div>

        {graph && graph.definitions.length > 0 && (
          <select
            value={String(graph.definition?.id ?? '')}
            onChange={(e) => setParams({ v: e.target.value || null, focus: null })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
            aria-label="Workflow version"
          >
            {graph.definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · v{d.version}
                {d.isActive ? ' (active)' : ' (draft)'}
              </option>
            ))}
          </select>
        )}

        {lens === 'live' && !editing && live && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
            {live.totalInFlight} in flight
          </span>
        )}

        {/* ─── Draft ▸ Publish controls ─── */}
        {canManage && graph?.definition && (
          <div className="ml-auto flex items-center gap-1.5">
            {!isDraft ? (
              <button
                onClick={() => void createDraft()}
                disabled={busy !== null}
                className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-50"
              >
                {busy === 'drafting' ? 'Creating draft…' : 'Edit as draft'}
              </button>
            ) : (
              <>
                <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                  Draft v{graph.definition.version}
                </span>
                <button
                  onClick={() => void saveDraft()}
                  disabled={!dirty || busy !== null}
                  className={[
                    'rounded-md px-3 py-1 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50',
                    dirty ? 'bg-slate-900 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-400',
                  ].join(' ')}
                >
                  {busy === 'saving' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                </button>
                <button
                  onClick={() => void publish()}
                  disabled={busy !== null}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === 'publishing' ? 'Publishing…' : 'Publish'}
                </button>
              </>
            )}
          </div>
        )}
        {actionError && <span className="text-[11px] font-semibold text-rose-600">{actionError}</span>}
      </header>

      {/* ─── Panes: full-width canvas + contextual inspector ─── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {error ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-rose-600">{error}</div>
          ) : !graph ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-slate-400">
              Loading the operations graph…
            </div>
          ) : !graph.definition ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-500">
              No workflow definition yet — seed one to see your operation here.
            </div>
          ) : z === 2 ? (
            <StudioStationPreview
              node={focusedNode}
              station={station}
              loading={stationLoading}
              onBack={() => setParams({ z: '1' })}
            />
          ) : (
            <StudioCanvas
              nodes={nodes}
              edges={edges}
              zoom={z}
              lens={lens}
              live={liveNodes}
              flowEdges={flowEdges}
              diagnostics={diagnostics}
              focus={focus}
              editable={editing}
              onGraphChange={onGraphChange}
              onFocus={(id) => setParams({ focus: id })}
              onZoomTo={(depth) => setParams({ z: String(depth) })}
              onOpenStation={(id) => setParams({ z: '2', focus: id })}
            />
          )}
        </main>

        {inspectorOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-slate-200 bg-white md:flex">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Inspector</span>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                title="Hide inspector"
                aria-label="Hide inspector panel"
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StudioInspector
                definition={graph?.definition ?? null}
                node={focusedNode}
                edges={edges}
                nodes={nodes}
                nodeCount={nodes.length}
                edgeCount={edges.length}
                live={focusedNode ? liveNodes?.[focusedNode.id] ?? null : null}
                diagnostics={focusedNode ? diagnostics.filter((d) => d.nodeId === focusedNode.id) : []}
                editable={editing}
                onUpdateConfig={onUpdateNodeConfig}
                onDeleteNode={onDeleteNode}
              />
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            title="Show inspector"
            aria-label="Show inspector panel"
            className="relative hidden w-8 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white py-3 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 md:flex"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
              Inspector
            </span>
            {/* A node is selected but its detail is tucked away — hint it. */}
            {focusedNode && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
