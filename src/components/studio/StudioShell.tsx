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
import { ChevronLeft, ChevronRight, Plus, Sparkles } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { useStudioWorkspace } from './StudioWorkspaceContext';
import { useStudioSimulation } from './useStudioSimulation';
import { StudioCanvas } from './StudioCanvas';
import { StudioInspector } from './StudioInspector';
import { StudioSimulatePanel } from './StudioSimulatePanel';
import { StudioStationPreview } from './StudioStationPreview';
import { StudioNodeStationEditor } from './StudioNodeStationEditor';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

export function StudioShell() {
  const {
    graph,
    error,
    nodes,
    edges,
    annotations,
    palette,
    z,
    lens,
    focus,
    focusedNode,
    diagnostics,
    liveNodes,
    flowEdges,
    flow,
    people,
    peopleNodes,
    live,
    station,
    stationLoading,
    reloadStation,
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
    onAddAnnotation,
    onMoveAnnotation,
    onUpdateAnnotationText,
    onDeleteAnnotation,
    createDraft,
    saveDraft,
    publish,
    discardDraft,
  } = useStudioWorkspace();

  // Inspector is a workspace preference (not shareable view state) → localStorage.
  const [inspectorOpen, setInspectorOpen] = useLocalStorage('studio:inspector-open', true);

  // ─── Simulate (ST6): a client-side ghost-run over the IN-CONTEXT graph (current
  // or draft). Pure dry-run — zero engine writes (see useStudioSimulation). The
  // panel takes over the inspector slot while open; the ghost paints on the canvas.
  const sim = useStudioSimulation(nodes, edges);
  const [simulateOpen, setSimulateOpen] = useLocalStorage('studio:simulate-open', false);
  const closeSimulate = () => {
    sim.reset();
    setSimulateOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      {/* ─── Header: title · version switcher · draft controls · in-flight count ─── */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight text-slate-900">Operations Studio</h1>
          <p className="text-caption text-slate-400">
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
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-caption font-semibold text-blue-700">
            {live.totalInFlight} in flight
          </span>
        )}

        {lens === 'people' && !editing && people && (
          <HoverTooltip
            label={
              people.uncoveredNodeIds.length > 0
                ? `${people.uncoveredNodeIds.length} step(s) with no staff coverage`
                : 'Every staffable step is covered'
            }
            asChild
          >
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-caption font-semibold text-violet-700">
              {people.totalCovering} covering
              {people.uncoveredNodeIds.length > 0 && ` · ${people.uncoveredNodeIds.length} gap`}
            </span>
          </HoverTooltip>
        )}

        {/* ─── Simulate toggle (ST6) — a read-only authoring aid, studio.view+ ─── */}
        {graph?.definition && (
          <HoverTooltip label="Walk a hypothetical unit through the graph — no real unit moves" asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSimulateOpen((open) => !open)}
              aria-pressed={simulateOpen}
              ariaLabel="Walk a hypothetical unit through the graph — no real unit moves"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              className={[
                'h-auto gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold',
                simulateOpen
                  ? 'border-violet-300 bg-violet-100 text-violet-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              Simulate
            </Button>
          </HoverTooltip>
        )}

        {/* ─── Draft ▸ Publish controls ─── */}
        {canManage && graph?.definition && (
          <div className="ml-auto flex items-center gap-1.5">
            {!isDraft ? (
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => void createDraft()}
                disabled={busy !== null}
                className="h-auto rounded-md px-3 py-1 text-xs font-semibold"
              >
                {busy === 'drafting' ? 'Creating draft…' : 'Edit as draft'}
              </Button>
            ) : (
              <>
                <span className="rounded-md bg-amber-100 px-2 py-1 text-caption font-bold uppercase tracking-wide text-amber-700">
                  Draft v{graph.definition.version}
                </span>
                {/* Add a sticky-note (Phase E3) — only on a draft (the active
                    version's notes are read-only); the canvas owns positioning. */}
                {editing && (
                  <HoverTooltip label="Drop a sticky-note on the canvas" asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onAddAnnotation()}
                      disabled={busy !== null}
                      ariaLabel="Drop a sticky-note on the canvas"
                      icon={<Plus className="h-3.5 w-3.5" />}
                      className="h-auto gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                    >
                      Add note
                    </Button>
                  </HoverTooltip>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void saveDraft()}
                  disabled={!dirty || busy !== null}
                  className={[
                    'h-auto rounded-md px-3 py-1 text-xs font-semibold shadow-sm',
                    dirty ? 'bg-slate-900 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-400',
                  ].join(' ')}
                >
                  {busy === 'saving' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void publish()}
                  disabled={busy !== null}
                  className="h-auto rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
                >
                  {busy === 'publishing' ? 'Publishing…' : 'Publish'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Discard this draft? Its unsaved-to-active changes are permanently removed. This cannot be undone.',
                      )
                    ) {
                      void discardDraft();
                    }
                  }}
                  disabled={busy !== null}
                  className="h-auto rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  {busy === 'discarding' ? 'Discarding…' : 'Discard draft'}
                </Button>
              </>
            )}
          </div>
        )}
        {actionError && <span className="text-caption font-semibold text-rose-600">{actionError}</span>}
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
            // Managers editing a focused node get the editable binding pane;
            // everyone else (or before a node is picked) keeps the read-only
            // preview with its "select a node" / "no station bound" empty states.
            canManage && focusedNode ? (
              <StudioNodeStationEditor
                node={focusedNode}
                station={station}
                onBack={() => setParams({ z: '1' })}
                reloadStation={reloadStation}
              />
            ) : (
              <StudioStationPreview
                node={focusedNode}
                station={station}
                loading={stationLoading}
                onBack={() => setParams({ z: '1' })}
              />
            )
          ) : (
            <StudioCanvas
              nodes={nodes}
              edges={edges}
              zoom={z}
              lens={lens}
              live={liveNodes}
              flowEdges={flowEdges}
              flow={flow}
              people={peopleNodes}
              diagnostics={diagnostics}
              focus={focus}
              editable={editing}
              onGraphChange={onGraphChange}
              onFocus={(id) => setParams({ focus: id })}
              onZoomTo={(depth) => setParams({ z: String(depth) })}
              onOpenStation={(id) => setParams({ z: '2', focus: id })}
              simGhostNodeId={simulateOpen ? sim.currentNodeId : null}
              simTraversedEdgeIds={simulateOpen ? sim.traversedEdgeIds : undefined}
              annotations={annotations}
              onMoveAnnotation={onMoveAnnotation}
              onUpdateAnnotationText={onUpdateAnnotationText}
              onDeleteAnnotation={onDeleteAnnotation}
            />
          )}
        </main>

        {/* ─── Simulate panel (ST6) — its own slot, orthogonal to the inspector ─── */}
        {simulateOpen && (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-slate-200 bg-white md:flex">
            <StudioSimulatePanel sim={sim} nodes={nodes} edges={edges} editing={editing} onClose={closeSimulate} />
          </aside>
        )}

        {inspectorOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-slate-200 bg-white md:flex">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-micro font-bold uppercase tracking-wider text-slate-400">Inspector</span>
              <HoverTooltip label="Hide inspector" asChild>
                <IconButton
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  ariaLabel="Hide inspector panel"
                  icon={<ChevronRight className="h-4 w-4" />}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                />
              </HoverTooltip>
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
                lens={lens}
                flow={flow}
                people={focusedNode ? peopleNodes?.[focusedNode.id] ?? null : null}
                diagnostics={focusedNode ? diagnostics.filter((d) => d.nodeId === focusedNode.id) : []}
                editable={editing}
                configSchema={
                  focusedNode
                    ? palette.find((p) => p.type === focusedNode.type)?.configSchema ?? null
                    : null
                }
                onUpdateConfig={onUpdateNodeConfig}
                onDeleteNode={onDeleteNode}
                onFocus={(id) => setParams({ focus: id })}
              />
            </div>
          </aside>
        ) : (
          <HoverTooltip label="Show inspector" asChild>
            {/* ds-raw-button: structural collapsed-rail toggle (flex-col, vertical writing-mode label, absolute indicator dot) — not a content button; no DS variant fits */}
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              aria-label="Show inspector panel"
              className="relative hidden w-8 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white py-3 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 md:flex"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-micro font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
                Inspector
              </span>
              {/* A node is selected but its detail is tucked away — hint it. */}
              {focusedNode && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          </HoverTooltip>
        )}
      </div>
    </div>
  );
}
