'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { runDiagnostics } from '@/lib/workflow/diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import type {
  Annotation,
  StudioGraphEdge,
  StudioGraphNode,
  StudioGraphResponse,
  StudioTemplateSummary,
  StudioTemplatesResponse,
} from '../studio-types';
import type { Busy } from './types';

const STATION_KEYS = new Set(STATIONS.map((s) => s.key));

interface StudioGraphDataParams {
  active: boolean;
  v: string | null;
  canManage: boolean;
}

/**
 * Owns the graph definition + draft working copy + template-library state, the
 * data-loading effects that hydrate them, and every value derived from the
 * draft-vs-published split (nodes / edges / annotations / diagnostics). The
 * mutation + lifecycle hooks operate on the setters this returns.
 */
export function useStudioGraphData({ active, v, canManage }: StudioGraphDataParams) {
  const [graph, setGraph] = useState<StudioGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // ─── Draft editing state (ST4) ───
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

  const isDraft = !!graph?.definition && !graph.definition.isActive;
  const editing = canManage && isDraft;

  // While editing, the working copy is what every pane renders.
  const nodes = editing ? draftNodes : graph?.nodes ?? [];
  const edges = editing ? draftEdges : graph?.edges ?? [];
  // Sticky-notes follow the same draft-vs-published split (Phase E3).
  const annotations = editing ? draftAnnotations : graph?.annotations ?? [];

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

  const definitionId = graph?.definition?.id ?? null;

  // ─── Draft mutations ───
  const markDirty = useCallback(() => {
    setDirty(true);
    setActionError(null);
  }, []);

  return {
    graph,
    error,
    setReloadNonce,
    draftNodes,
    setDraftNodes,
    draftEdges,
    setDraftEdges,
    draftAnnotations,
    setDraftAnnotations,
    dirty,
    setDirty,
    busy,
    setBusy,
    actionError,
    setActionError,
    templates,
    importingTemplateId,
    setImportingTemplateId,
    isDraft,
    editing,
    nodes,
    edges,
    annotations,
    palette,
    paletteByType,
    diagnostics,
    definitionId,
    markDirty,
  };
}
