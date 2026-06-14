'use client';

/**
 * StudioShell — the three-pane Operations Studio layout.
 *
 *   Library | Canvas (React Flow, L0 ⇄ L1 semantic zoom) | Inspector
 *
 * View state is URL-persisted so any view is shareable/bookmarkable:
 *   ?v=     workflow definition id (default: the org's active one)
 *   ?focus= node id (Inspector target + canvas highlight)
 *   ?z=     zoom depth — 0 business map, 1 flow graph (default), 2 station detail
 *   ?lens=  build (default) | static | live | gaps
 *
 * Lenses are render layers (Studio law #3): the GRAPH is fetched once per
 * definition and only repainted. The Live lens (ST2) adds one occupancy
 * fetch + an Ably subscription to the engine's item_workflow_state db-events
 * — refreshes are event-driven with a trailing debounce, never a poll
 * interval (law #4, Neon CU cost).
 *
 * Editing (ST4) is DRAFT-FIRST (law #6): viewing an inactive version with
 * studio.manage turns the canvas editable against a local working copy;
 * "Save draft" PUTs the full graph; "Publish" runs the blocking diagnostics
 * server-side inside the activation transaction and requires a step-up
 * grant (law #7). The active version is never editable. While editing, the
 * Issues rail re-lints CLIENT-side on every change (diagnostics.ts is pure),
 * so gaps surface as you wire, not after you save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStepUp } from '@/components/providers/StepUpProvider';
import { fetchWithStepUp } from '@/components/auth/StepUpModal';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getDbTableChannelName, safeChannelName } from '@/lib/realtime/channels';
import { runDiagnostics } from '@/lib/workflow/diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import { StudioCanvas } from './StudioCanvas';
import { StudioInspector } from './StudioInspector';
import { StudioLibrary } from './StudioLibrary';
import { StudioStationPreview } from './StudioStationPreview';
import type {
  StudioGraphEdge,
  StudioGraphNode,
  StudioGraphResponse,
  StudioLens,
  StudioLiveResponse,
  StudioStationResponse,
  StudioStationView,
  StudioZoom,
} from './studio-types';

const LENSES: ReadonlyArray<{ id: StudioLens | 'flow2' | 'people'; label: string; enabled: boolean; hint?: string }> = [
  { id: 'build', label: 'Build', enabled: true },
  { id: 'static', label: 'Static', enabled: true },
  { id: 'live', label: 'Live', enabled: true },
  { id: 'flow2', label: 'Flow²', enabled: false, hint: 'a later phase' },
  { id: 'people', label: 'People', enabled: false, hint: 'ST6' },
  { id: 'gaps', label: 'Gaps', enabled: true },
];

/** Trailing debounce for event-driven live refreshes (burst of scans → one fetch). */
const LIVE_REFRESH_DEBOUNCE_MS = 1200;
/** How long an edge stays lit (blue pulse) after a unit traverses it. */
const FLOW_PING_TTL_MS = 1500;
/** Stable empty set so the canvas's flowEdges prop is referentially stable when idle. */
const EMPTY_FLOW: ReadonlySet<string> = new Set();

const STATION_KEYS = new Set(STATIONS.map((s) => s.key));

export function StudioShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { has, user } = useAuth();
  const requestStepUp = useStepUp();

  const v = searchParams.get('v');
  const focus = searchParams.get('focus');
  const zRaw = searchParams.get('z');
  const zParam: StudioZoom = zRaw === '0' ? 0 : zRaw === '2' ? 2 : 1;
  const lensRaw = searchParams.get('lens');
  const lens: StudioLens =
    lensRaw === 'live' || lensRaw === 'gaps' || lensRaw === 'static' ? lensRaw : 'build';

  const [graph, setGraph] = useState<StudioGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<StudioLiveResponse | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Recently-traversed edges (Live lens), keyed `${sourceNode} ${sourcePort}`.
  const [flowEdges, setFlowEdges] = useState<ReadonlySet<string>>(EMPTY_FLOW);
  const flowTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // L2 station detail (read-only) for the focused node.
  const [station, setStation] = useState<StudioStationView | null>(null);
  const [stationLoading, setStationLoading] = useState(false);
  const stationAbort = useRef<AbortController | null>(null);

  // ─── Draft editing state (ST4) ───
  const canManage = has('studio.manage');
  const isDraft = !!graph?.definition && !graph.definition.isActive;
  const editing = canManage && isDraft;
  const [draftNodes, setDraftNodes] = useState<StudioGraphNode[]>([]);
  const [draftEdges, setDraftEdges] = useState<StudioGraphEdge[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'saving' | 'publishing' | 'drafting'>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    void (async () => {
      try {
        const qs = v ? `?v=${encodeURIComponent(v)}` : '';
        const res = await fetch(`/api/studio/graph${qs}`, { cache: 'no-store' });
        const data = (await res.json()) as StudioGraphResponse;
        if (!alive) return;
        if (!data.ok) {
          setError(data.error || 'Failed to load the operations graph');
          return;
        }
        setGraph(data);
        setDraftNodes(data.nodes);
        setDraftEdges(data.edges);
        setDirty(false);
        setActionError(null);
      } catch {
        if (alive) setError('Failed to load the operations graph');
      }
    })();
    return () => {
      alive = false;
    };
  }, [v, reloadNonce]);

  // While editing, the working copy is what every pane renders.
  const nodes = editing ? draftNodes : graph?.nodes ?? [];
  const edges = editing ? draftEdges : graph?.edges ?? [];
  // L0 is a read-only aggregate; L2 (station detail) needs a focused node.
  const z: StudioZoom = editing ? 1 : zParam === 2 && !focus ? 1 : zParam;

  const paletteByType = useMemo(
    () => new Map((graph?.palette ?? []).map((p) => [p.type, p])),
    [graph],
  );

  // Issues: server-computed for published views, re-linted locally per edit.
  const diagnostics = useMemo(() => {
    if (!editing) return graph?.diagnostics ?? [];
    return runDiagnostics({
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, config: n.config })),
      edges,
      portsOf: (type) => paletteByType.get(type)?.outputs.map((o) => o.id) ?? null,
      stationKeys: STATION_KEYS,
      labelOf: (n) => paletteByType.get(n.type)?.label ?? n.type,
    });
  }, [editing, graph, nodes, edges, paletteByType]);

  // ─── Live lens: one fetch on activation, then Ably-driven refreshes ───
  const liveAbort = useRef<AbortController | null>(null);
  const fetchLive = useCallback(async () => {
    liveAbort.current?.abort();
    const controller = new AbortController();
    liveAbort.current = controller;
    try {
      const qs = v ? `?v=${encodeURIComponent(v)}` : '';
      const res = await fetch(`/api/studio/live${qs}`, { cache: 'no-store', signal: controller.signal });
      const data = (await res.json()) as StudioLiveResponse;
      if (data.ok) setLive(data);
    } catch {
      /* live paint is best-effort; the graph stands on its own */
    }
  }, [v]);

  useEffect(() => {
    if (lens !== 'live') return;
    void fetchLive();
  }, [lens, fetchLive]);

  // Light an edge for FLOW_PING_TTL_MS, then let it fade (self-cancelling timer).
  const pingEdge = useCallback((key: string) => {
    setFlowEdges((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const timers = flowTimers.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        setFlowEdges((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, FLOW_PING_TTL_MS),
    );
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemStateChannel = safeChannelName(() =>
    getDbTableChannelName(user?.organizationId ?? '', 'public', 'item_workflow_state'),
  );
  useAblyChannel(
    itemStateChannel,
    'db.row.changed',
    (msg: { data?: { row?: Record<string, unknown> | null } }) => {
      // Per-edge flow pulse (best-effort): the engine's WorkflowEvent carries the
      // source node instance id + output port — exactly one edge.
      const row = msg?.data?.row;
      if (row && typeof row.nodeId === 'string' && typeof row.output === 'string') {
        const sameDef =
          row.workflowDefinitionId == null || row.workflowDefinitionId === graph?.definition?.id;
        if (sameDef) pingEdge(`${row.nodeId} ${row.output}`);
      }
      // Debounced occupancy refetch (one fetch per burst of scans).
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void fetchLive(), LIVE_REFRESH_DEBOUNCE_MS);
    },
    lens === 'live' && !!itemStateChannel,
  );
  useEffect(() => {
    const timers = flowTimers.current;
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      liveAbort.current?.abort();
      stationAbort.current?.abort();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // ─── L2 station detail: fetch the focused node's bound station (read-only) ───
  useEffect(() => {
    if (z !== 2 || !focus) {
      setStation(null);
      return;
    }
    stationAbort.current?.abort();
    const controller = new AbortController();
    stationAbort.current = controller;
    setStationLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/studio/nodes/${encodeURIComponent(focus)}/station`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = (await res.json()) as StudioStationResponse;
        if (!controller.signal.aborted) setStation(data.ok ? data.station : null);
      } catch {
        if (!controller.signal.aborted) setStation(null);
      } finally {
        if (!controller.signal.aborted) setStationLoading(false);
      }
    })();
    return () => controller.abort();
  }, [z, focus]);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `/studio?${qs}` : '/studio', { scroll: false });
    },
    [router, searchParams],
  );

  // ─── Draft mutations ───
  const markDirty = useCallback(() => {
    setDirty(true);
    setActionError(null);
  }, []);

  const onGraphChange = useCallback(
    (patch: { nodes?: StudioGraphNode[]; edges?: StudioGraphEdge[] }) => {
      if (patch.nodes) setDraftNodes(patch.nodes);
      if (patch.edges) setDraftEdges(patch.edges);
      markDirty();
    },
    [markDirty],
  );

  const onAddNode = useCallback(
    (type: string) => {
      const meta = paletteByType.get(type) ?? null;
      setDraftNodes((prev) => {
        const maxY = prev.length ? Math.max(...prev.map((n) => n.y)) : 140;
        return [
          ...prev,
          {
            id: `n-${crypto.randomUUID()}`,
            type,
            x: 40 + (prev.length % 5) * 290,
            y: maxY + 260,
            config: {},
            meta: meta
              ? { label: meta.label, icon: meta.icon, category: meta.category, outputs: meta.outputs }
              : null,
          },
        ];
      });
      markDirty();
    },
    [paletteByType, markDirty],
  );

  const onUpdateNodeConfig = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setDraftNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const config = { ...n.config };
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') delete config[key];
            else config[key] = value;
          }
          return { ...n, config };
        }),
      );
      markDirty();
    },
    [markDirty],
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setDraftNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setDraftEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (focus === nodeId) setParams({ focus: null });
      markDirty();
    },
    [focus, setParams, markDirty],
  );

  // ─── Draft lifecycle: create / save / publish ───
  const definitionId = graph?.definition?.id ?? null;

  const createDraft = useCallback(async () => {
    setBusy('drafting');
    setActionError(null);
    try {
      const res = await fetch('/api/studio/definitions/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definitionId ? { sourceId: definitionId } : {}),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'draft creation failed');
      setParams({ v: String(data.id), focus: null, z: null });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'draft creation failed');
    } finally {
      setBusy(null);
    }
  }, [definitionId, setParams]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!definitionId) return false;
    setBusy('saving');
    setActionError(null);
    try {
      const res = await fetch(`/api/studio/definitions/${definitionId}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: draftNodes.map(({ id, type, x, y, config }) => ({ id, type, x, y, config })),
          edges: draftEdges.map(({ id, source, sourcePort, target }) => ({ id, source, sourcePort, target })),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'save failed');
      setDirty(false);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'save failed');
      return false;
    } finally {
      setBusy(null);
    }
  }, [definitionId, draftNodes, draftEdges]);

  const publish = useCallback(async () => {
    if (!definitionId) return;
    if (dirty && !(await saveDraft())) return;
    setBusy('publishing');
    setActionError(null);
    try {
      const res = await fetchWithStepUp(
        `/api/studio/definitions/${definitionId}/publish`,
        { method: 'POST' },
        requestStepUp,
      );
      const data = await res.json();
      if (!data.ok) {
        if (data.error === 'PUBLISH_BLOCKED') {
          setParams({ lens: 'gaps' });
          throw new Error(
            `Publish blocked by ${data.diagnostics?.length ?? 0} error(s) — fix the Issues rail first.`,
          );
        }
        throw new Error(data.error || 'publish failed');
      }
      setParams({ v: null, focus: null });
      setReloadNonce((n) => n + 1); // v may already be null — force the refetch
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(null);
    }
  }, [definitionId, dirty, saveDraft, requestStepUp, setParams]);

  const focusedNode = useMemo(() => nodes.find((n) => n.id === focus) ?? null, [nodes, focus]);
  const liveNodes = lens === 'live' && !editing ? live?.nodes ?? null : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      {/* ─── Header: title · version switcher · zoom · draft controls · lens bar ─── */}
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

        <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="tablist" aria-label="Zoom depth">
          {([
            { depth: 0 as const, label: 'L0 · Map', needsFocus: false },
            { depth: 1 as const, label: 'L1 · Flow', needsFocus: false },
            { depth: 2 as const, label: 'L2 · Station', needsFocus: true },
          ]).map((opt) => {
            const disabled = (editing && opt.depth !== 1) || (opt.needsFocus && !focus);
            const title =
              opt.depth === 2 && !focus
                ? 'Select a step first, then open its station'
                : editing && opt.depth !== 1
                  ? 'Read-only at this depth — finish editing first'
                  : undefined;
            return (
              <button
                key={opt.depth}
                role="tab"
                aria-selected={z === opt.depth}
                disabled={disabled}
                title={title}
                // L2 keeps the focused node; L0/L1 clear it.
                onClick={() => setParams(opt.depth === 2 ? { z: '2' } : { z: String(opt.depth), focus: null })}
                className={[
                  'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                  z === opt.depth
                    ? 'bg-white text-slate-900 shadow-sm'
                    : disabled
                      ? 'cursor-not-allowed text-slate-300'
                      : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {lens === 'live' && !editing && live && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
            {live.totalInFlight} in flight
          </span>
        )}

        {/* ─── Draft ▸ Publish controls ─── */}
        {canManage && graph?.definition && (
          <div className="flex items-center gap-1.5">
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

        <div className="ml-auto flex items-center gap-1" aria-label="Lenses">
          {LENSES.map((l) => {
            const disabled = !l.enabled || (editing && l.id === 'live');
            return (
              <button
                key={l.id}
                disabled={disabled}
                onClick={() => !disabled && setParams({ lens: l.id === 'build' ? null : l.id })}
                title={
                  !l.enabled
                    ? `Arrives with ${l.hint ?? 'a later phase'}`
                    : editing && l.id === 'live'
                      ? 'Drafts have no live traffic'
                      : undefined
                }
                className={[
                  'rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : lens === l.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100',
                ].join(' ')}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── Panes ─── */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block">
          <StudioLibrary
            palette={graph?.palette ?? []}
            diagnostics={diagnostics}
            editable={editing}
            onAddNode={onAddNode}
            onFocusIssue={(nodeId) =>
              setParams({ focus: nodeId, z: '1', lens: editing ? 'gaps' : 'gaps' })
            }
          />
        </aside>

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

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white md:block">
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
        </aside>
      </div>
    </div>
  );
}
