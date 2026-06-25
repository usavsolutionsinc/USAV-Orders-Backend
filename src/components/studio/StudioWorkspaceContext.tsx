'use client';

/**
 * StudioWorkspaceContext — the single owner of all Operations Studio client
 * state.
 *
 * The Studio is painted by two sibling React subtrees that must share state:
 *   • the master-nav route panel (StudioSidebarPanel) — View dropdown + the
 *     node Library + the Issues rail, and
 *   • the page body (StudioShell) — the canvas + inspector.
 * Because those live in different layout slots (sidebar vs. main), neither can
 * be the other's parent. So — mirroring FbaWorkspaceProvider — this provider is
 * mounted once high in app/layout.tsx and both subtrees read it via
 * `useStudioWorkspace()`. View state still round-trips through the URL
 * (`?v=&focus=&z=&lens=`); the provider just centralises the data + handlers.
 *
 * Off-route it is inert: every fetch / Ably subscription is gated on the
 * pathname being `/studio`, so other pages pay nothing for it being mounted.
 *
 * Lenses are render layers (Studio law #3): the GRAPH is fetched once per
 * definition and only repainted. Live (ST2) adds one occupancy fetch + an Ably
 * subscription to the engine's item_workflow_state db-events — refreshes are
 * event-driven with a trailing debounce, never a poll interval (law #4).
 *
 * Editing (ST4) is DRAFT-FIRST (law #6): viewing an inactive version with
 * studio.manage edits a local working copy; "Save draft" PUTs the full graph;
 * "Publish" runs blocking diagnostics server-side inside the activation
 * transaction behind a step-up grant (law #7). The active version is never
 * editable. While editing, diagnostics re-lint CLIENT-side on every change
 * (diagnostics.ts is pure) so gaps surface as you wire.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { useAuth } from '@/contexts/AuthContext';
import { useStepUp } from '@/components/providers/StepUpProvider';
import { fetchWithStepUp } from '@/components/auth/StepUpModal';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getDbTableChannelName, safeChannelName } from '@/lib/realtime/channels';
import { runDiagnostics } from '@/lib/workflow/diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import type {
  Annotation,
  Diagnostic,
  PeopleNodeCoverage,
  StudioFlowResponse,
  StudioGraphEdge,
  StudioGraphNode,
  StudioGraphResponse,
  StudioLens,
  StudioLiveNode,
  StudioLiveResponse,
  StudioPeopleResponse,
  StudioStationResponse,
  StudioStationView,
  StudioTemplateSummary,
  StudioTemplatesResponse,
  StudioZoom,
} from './studio-types';

/** Trailing debounce for event-driven live refreshes (burst of scans → one fetch). */
const LIVE_REFRESH_DEBOUNCE_MS = 1200;
/** How long an edge stays lit (blue pulse) after a unit traverses it. */
const FLOW_PING_TTL_MS = 1500;
/** Stable empty set so the canvas's flowEdges prop is referentially stable when idle. */
const EMPTY_FLOW: ReadonlySet<string> = new Set();

const STATION_KEYS = new Set(STATIONS.map((s) => s.key));

type Busy = null | 'saving' | 'publishing' | 'drafting' | 'discarding';

export interface StudioWorkspaceValue {
  /** Whether the user is currently on the /studio route (provider is active). */
  active: boolean;

  // ─── URL-derived view state ───
  v: string | null;
  focus: string | null;
  z: StudioZoom;
  lens: StudioLens;
  setParams: (patch: Record<string, string | null>) => void;

  // ─── Graph + derived ───
  graph: StudioGraphResponse | null;
  error: string | null;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  /** Canvas sticky-notes (Phase E3) — working copy while editing, else the published set. */
  annotations: Annotation[];
  palette: StudioGraphResponse['palette'];
  diagnostics: Diagnostic[];
  focusedNode: StudioGraphNode | null;

  // ─── Live lens ───
  live: StudioLiveResponse | null;
  liveNodes: Record<string, StudioLiveNode> | null;
  flowEdges: ReadonlySet<string>;

  // ─── Flow² lens ───
  flow: StudioFlowResponse | null;
  flowLoading: boolean;

  // ─── People lens ───
  people: StudioPeopleResponse | null;
  peopleNodes: Record<string, PeopleNodeCoverage> | null;
  peopleLoading: boolean;

  // ─── L2 station detail ───
  station: StudioStationView | null;
  stationLoading: boolean;
  /** Force-refetch the focused node's bound station (after an L2 edit/publish). */
  reloadStation: () => void;

  // ─── Draft editing state (ST4) ───
  canManage: boolean;
  isDraft: boolean;
  editing: boolean;
  dirty: boolean;
  busy: Busy;
  actionError: string | null;

  // ─── Template library (ST6 / Phase E4) ───
  templates: StudioTemplateSummary[];
  /** The template currently being imported (a clone is in flight), else null. */
  importingTemplateId: number | null;

  // ─── Handlers ───
  onGraphChange: (patch: { nodes?: StudioGraphNode[]; edges?: StudioGraphEdge[] }) => void;
  onAddNode: (type: string) => void;
  onUpdateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string) => void;
  // ─── Annotation CRUD (Phase E3) — draft-only sticky-note edits ───
  onAddAnnotation: () => void;
  onMoveAnnotation: (id: string, x: number, y: number) => void;
  onUpdateAnnotationText: (id: string, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  createDraft: () => Promise<void>;
  saveDraft: () => Promise<boolean>;
  publish: () => Promise<void>;
  discardDraft: () => Promise<void>;
  /** Clone a system template into the org as a new draft, then switch to it. */
  importTemplate: (templateId: number) => Promise<void>;
}

const StudioWorkspaceContext = createContext<StudioWorkspaceValue | undefined>(undefined);

export function StudioWorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { has, user } = useAuth();
  const requestStepUp = useStepUp();

  const active = !!pathname && (pathname === '/studio' || pathname.startsWith('/studio/'));

  const v = searchParams.get('v');
  const focus = searchParams.get('focus');
  const zRaw = searchParams.get('z');
  const zParam: StudioZoom = zRaw === '0' ? 0 : zRaw === '2' ? 2 : 1;
  const lensRaw = searchParams.get('lens');
  const lens: StudioLens =
    lensRaw === 'live' ||
    lensRaw === 'gaps' ||
    lensRaw === 'static' ||
    lensRaw === 'flow' ||
    lensRaw === 'people'
      ? lensRaw
      : 'build';

  const [graph, setGraph] = useState<StudioGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<StudioLiveResponse | null>(null);
  const [flow, setFlow] = useState<StudioFlowResponse | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [people, setPeople] = useState<StudioPeopleResponse | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Recently-traversed edges (Live lens), keyed `${sourceNode} ${sourcePort}`.
  const [flowEdges, setFlowEdges] = useState<ReadonlySet<string>>(EMPTY_FLOW);
  const flowTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // L2 station detail for the focused node.
  const [station, setStation] = useState<StudioStationView | null>(null);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationReloadNonce, setStationReloadNonce] = useState(0);
  const stationAbort = useRef<AbortController | null>(null);
  const reloadStation = useCallback(() => setStationReloadNonce((n) => n + 1), []);

  // ─── Draft editing state (ST4) ───
  const canManage = has('studio.manage');
  const isDraft = !!graph?.definition && !graph.definition.isActive;
  const editing = canManage && isDraft;
  const [draftNodes, setDraftNodes] = useState<StudioGraphNode[]>([]);
  const [draftEdges, setDraftEdges] = useState<StudioGraphEdge[]>([]);
  const [draftAnnotations, setDraftAnnotations] = useState<Annotation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Template library (ST6 / Phase E4): system-owned blueprints to clone ───
  const [templates, setTemplates] = useState<StudioTemplateSummary[]>([]);
  const [importingTemplateId, setImportingTemplateId] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
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
        setDraftAnnotations(data.annotations ?? []);
        setDirty(false);
        setActionError(null);
      } catch {
        if (alive) setError('Failed to load the operations graph');
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, v, reloadNonce]);

  // While editing, the working copy is what every pane renders.
  const nodes = editing ? draftNodes : graph?.nodes ?? [];
  const edges = editing ? draftEdges : graph?.edges ?? [];
  // Sticky-notes follow the same draft-vs-published split (Phase E3).
  const annotations = editing ? draftAnnotations : graph?.annotations ?? [];
  // Editing forces L1 (the canvas is the only editable surface). Otherwise the
  // URL zoom stands on its own: a cold `?z=2` without `?focus` still lands on
  // L2 — the station pane renders a "pick a node" empty state — so deep links
  // are reproducible rather than silently demoted to L1.
  const z: StudioZoom = editing ? 1 : zParam;

  const palette = graph?.palette ?? [];
  const paletteByType = useMemo(
    () => new Map(palette.map((p) => [p.type, p])),
    [palette],
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
    if (!active || lens !== 'live') return;
    void fetchLive();
  }, [active, lens, fetchLive]);

  // ─── Flow² lens: one fetch on activation (data changes ≤ daily — never poll) ───
  const flowAbort = useRef<AbortController | null>(null);
  const fetchFlow = useCallback(async () => {
    flowAbort.current?.abort();
    const controller = new AbortController();
    flowAbort.current = controller;
    setFlowLoading(true);
    try {
      const qs = v ? `?v=${encodeURIComponent(v)}` : '';
      const res = await fetch(`/api/studio/flow${qs}`, { cache: 'no-store', signal: controller.signal });
      const data = (await res.json()) as StudioFlowResponse;
      if (!controller.signal.aborted && data.ok) setFlow(data);
    } catch {
      /* flow paint is best-effort; the graph stands on its own */
    } finally {
      if (!controller.signal.aborted) setFlowLoading(false);
    }
  }, [v]);

  useEffect(() => {
    if (!active || lens !== 'flow') return;
    void fetchFlow();
  }, [active, lens, fetchFlow]);

  // ─── People lens: one fetch on activation (staff↔station rarely changes — no poll) ───
  const peopleAbort = useRef<AbortController | null>(null);
  const fetchPeople = useCallback(async () => {
    peopleAbort.current?.abort();
    const controller = new AbortController();
    peopleAbort.current = controller;
    setPeopleLoading(true);
    try {
      const qs = v ? `?v=${encodeURIComponent(v)}` : '';
      const res = await fetch(`/api/studio/people${qs}`, { cache: 'no-store', signal: controller.signal });
      const data = (await res.json()) as StudioPeopleResponse;
      if (!controller.signal.aborted && data.ok) setPeople(data);
    } catch {
      /* people paint is best-effort; the graph stands on its own */
    } finally {
      if (!controller.signal.aborted) setPeopleLoading(false);
    }
  }, [v]);

  useEffect(() => {
    if (!active || lens !== 'people') return;
    void fetchPeople();
  }, [active, lens, fetchPeople]);

  // ─── Template library: one fetch on activation (system blueprints rarely change) ───
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/studio/templates', { cache: 'no-store' });
        const data = (await res.json()) as StudioTemplatesResponse;
        if (alive && data.ok) setTemplates(data.templates);
      } catch {
        /* the library degrades gracefully without templates */
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);

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
    active && lens === 'live' && !!itemStateChannel,
  );
  useEffect(() => {
    const timers = flowTimers.current;
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      liveAbort.current?.abort();
      flowAbort.current?.abort();
      peopleAbort.current?.abort();
      stationAbort.current?.abort();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // ─── L2 station detail: fetch the focused node's bound station (read-only) ───
  useEffect(() => {
    if (!active || z !== 2 || !focus) {
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
  }, [active, z, focus, stationReloadNonce]);

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
            id: `n-${safeRandomUUID()}`,
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

  // ─── Annotation CRUD (Phase E3) — sticky-notes on the draft working copy ───
  // Pure canvas decorations: they never touch nodes/edges/diagnostics. A new
  // note lands offset from the busiest area so it doesn't bury the graph.
  const onAddAnnotation = useCallback(() => {
    setDraftAnnotations((prev) => {
      const baseX = prev.length ? Math.max(...prev.map((a) => a.x)) + 40 : 80;
      const baseY = prev.length ? Math.min(...prev.map((a) => a.y)) - 20 : 80;
      return [
        ...prev,
        { id: `a-${safeRandomUUID()}`, text: '', x: baseX, y: baseY },
      ];
    });
    markDirty();
  }, [markDirty]);

  const onMoveAnnotation = useCallback(
    (id: string, x: number, y: number) => {
      setDraftAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, x, y } : a)));
      markDirty();
    },
    [markDirty],
  );

  const onUpdateAnnotationText = useCallback(
    (id: string, text: string) => {
      setDraftAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)));
      markDirty();
    },
    [markDirty],
  );

  const onDeleteAnnotation = useCallback(
    (id: string) => {
      setDraftAnnotations((prev) => prev.filter((a) => a.id !== id));
      markDirty();
    },
    [markDirty],
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
          annotations: draftAnnotations.map(({ id, text, x, y, color }) => ({ id, text, x, y, color })),
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
  }, [definitionId, draftNodes, draftEdges, draftAnnotations]);

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

  // Discard the draft: DELETE the never-published version, then drop ?v so the
  // graph reloads to the org's active definition. No step-up (it's destructive
  // but only ever touches an un-activated draft; the route refuses the active
  // version + any draft still referenced by in-flight items). Mirrors
  // createDraft/saveDraft/publish busy + error handling.
  const discardDraft = useCallback(async () => {
    if (!definitionId) return;
    setBusy('discarding');
    setActionError(null);
    try {
      const res = await fetch(`/api/studio/definitions/${definitionId}/discard`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'discard failed');
      setParams({ v: null, focus: null, z: null });
      setReloadNonce((n) => n + 1); // v may already be null — force the refetch
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'discard failed');
    } finally {
      setBusy(null);
    }
  }, [definitionId, setParams]);

  // Import a system template: clone it into the org as a new draft, then switch
  // the canvas to it (`?v=<newId>`) — editing engages because the new draft is
  // is_active=false and the user has studio.manage. Mirrors createDraft's
  // error/param handling, but keyed by a per-template in-flight id so the card
  // can show its own spinner.
  const importTemplate = useCallback(
    async (templateId: number) => {
      setImportingTemplateId(templateId);
      setActionError(null);
      try {
        const res = await fetch(`/api/studio/templates/${templateId}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'template import failed');
        setParams({ v: String(data.id), focus: null, z: null });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'template import failed');
      } finally {
        setImportingTemplateId(null);
      }
    },
    [setParams],
  );

  const focusedNode = useMemo(() => nodes.find((n) => n.id === focus) ?? null, [nodes, focus]);
  const liveNodes = lens === 'live' && !editing ? live?.nodes ?? null : null;
  const flowData = lens === 'flow' && !editing ? flow : null;
  const peopleData = lens === 'people' && !editing ? people : null;
  const peopleNodes = peopleData?.nodes ?? null;

  const value = useMemo<StudioWorkspaceValue>(
    () => ({
      active,
      v,
      focus,
      z,
      lens,
      setParams,
      graph,
      error,
      nodes,
      edges,
      annotations,
      palette,
      diagnostics,
      focusedNode,
      live,
      liveNodes,
      flowEdges,
      flow: flowData,
      flowLoading,
      people: peopleData,
      peopleNodes,
      peopleLoading,
      station,
      stationLoading,
      reloadStation,
      canManage,
      isDraft,
      editing,
      dirty,
      busy,
      actionError,
      templates,
      importingTemplateId,
      onGraphChange,
      onAddNode,
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
      importTemplate,
    }),
    [
      active,
      v,
      focus,
      z,
      lens,
      setParams,
      graph,
      error,
      nodes,
      edges,
      annotations,
      palette,
      diagnostics,
      focusedNode,
      live,
      liveNodes,
      flowEdges,
      flowData,
      flowLoading,
      peopleData,
      peopleNodes,
      peopleLoading,
      station,
      stationLoading,
      reloadStation,
      canManage,
      isDraft,
      editing,
      dirty,
      busy,
      actionError,
      templates,
      importingTemplateId,
      onGraphChange,
      onAddNode,
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
      importTemplate,
    ],
  );

  return <StudioWorkspaceContext.Provider value={value}>{children}</StudioWorkspaceContext.Provider>;
}

export function useStudioWorkspace(): StudioWorkspaceValue {
  const ctx = useContext(StudioWorkspaceContext);
  if (!ctx) throw new Error('useStudioWorkspace must be used within a StudioWorkspaceProvider');
  return ctx;
}
