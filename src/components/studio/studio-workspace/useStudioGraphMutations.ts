'use client';

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { safeRandomUUID } from '@/lib/safe-uuid';
import type {
  Annotation,
  StudioGraphEdge,
  StudioGraphNode,
  StudioGraphResponse,
} from '../studio-types';

type PaletteByType = Map<string, StudioGraphResponse['palette'][number]>;

export interface StudioGraphMutationsParams {
  focus: string | null;
  paletteByType: PaletteByType;
  setDraftNodes: Dispatch<SetStateAction<StudioGraphNode[]>>;
  setDraftEdges: Dispatch<SetStateAction<StudioGraphEdge[]>>;
  setDraftAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  setParams: (patch: Record<string, string | null>) => void;
  markDirty: () => void;
}

/** Draft-only node / edge / annotation edits — every change marks the draft dirty. */
export function useStudioGraphMutations({
  focus,
  paletteByType,
  setDraftNodes,
  setDraftEdges,
  setDraftAnnotations,
  setParams,
  markDirty,
}: StudioGraphMutationsParams) {
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

  return {
    onGraphChange,
    onAddNode,
    onUpdateNodeConfig,
    onDeleteNode,
    onAddAnnotation,
    onMoveAnnotation,
    onUpdateAnnotationText,
    onDeleteAnnotation,
  };
}
