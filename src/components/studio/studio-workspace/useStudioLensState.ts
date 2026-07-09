'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getDbTableChannelName, safeChannelName } from '@/lib/realtime/channels';
import type {
  StudioFlowResponse,
  StudioGraphResponse,
  StudioLens,
  StudioLiveResponse,
  StudioPeopleResponse,
} from '../studio-types';

/** Trailing debounce for event-driven live refreshes (burst of scans → one fetch). */
const LIVE_REFRESH_DEBOUNCE_MS = 1200;
/** How long an edge stays lit (blue pulse) after a unit traverses it. */
const FLOW_PING_TTL_MS = 1500;
/** Stable empty set so the canvas's flowEdges prop is referentially stable when idle. */
const EMPTY_FLOW: ReadonlySet<string> = new Set();

interface StudioLensStateParams {
  active: boolean;
  v: string | null;
  lens: StudioLens;
  editing: boolean;
  graph: StudioGraphResponse | null;
  organizationId: string | undefined;
}

/**
 * Lens render-layers (Studio law #3): the graph is fetched once per definition
 * and only repainted. Live adds one occupancy fetch + an Ably subscription to
 * the engine's item_workflow_state db-events; Flow² / People each fetch once on
 * activation. All paints are best-effort — the graph stands on its own.
 */
export function useStudioLensState({
  active,
  v,
  lens,
  editing,
  graph,
  organizationId,
}: StudioLensStateParams) {
  const [live, setLive] = useState<StudioLiveResponse | null>(null);
  const [flow, setFlow] = useState<StudioFlowResponse | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [people, setPeople] = useState<StudioPeopleResponse | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  // Recently-traversed edges (Live lens), keyed `${sourceNode} ${sourcePort}`.
  const [flowEdges, setFlowEdges] = useState<ReadonlySet<string>>(EMPTY_FLOW);
  const flowTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
    getDbTableChannelName(organizationId ?? '', 'public', 'item_workflow_state'),
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
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const liveNodes = lens === 'live' && !editing ? live?.nodes ?? null : null;
  const flowData = lens === 'flow' && !editing ? flow : null;
  const peopleData = lens === 'people' && !editing ? people : null;
  const peopleNodes = peopleData?.nodes ?? null;

  return {
    live,
    liveNodes,
    flowEdges,
    flowData,
    flowLoading,
    peopleData,
    peopleNodes,
    peopleLoading,
  };
}
