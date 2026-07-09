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
 * This file is a thin composition shell. The state, effects and handlers live
 * in focused hooks under `studio-workspace/`:
 *   • useStudioViewState     — URL-derived view (`?v=&focus=&z=&lens=`) + setParams
 *   • useStudioGraphData     — graph + draft + template state, fetch effects, derived
 *   • useStudioGraphMutations — draft-only node / edge / annotation edits
 *   • useStudioPublish        — draft lifecycle (create / save / publish / discard / import)
 *   • useStudioLensState      — Live / Flow² / People lens fetches + flow pulses
 *   • useStudioStation        — L2 station detail
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

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { StudioZoom } from './studio-types';
import type { StudioWorkspaceValue } from './studio-workspace/types';
import { useStudioViewState } from './studio-workspace/useStudioViewState';
import { useStudioGraphData } from './studio-workspace/useStudioGraphData';
import { useStudioGraphMutations } from './studio-workspace/useStudioGraphMutations';
import { useStudioPublish } from './studio-workspace/useStudioPublish';
import { useStudioLensState } from './studio-workspace/useStudioLensState';
import { useStudioStation } from './studio-workspace/useStudioStation';

export type { StudioWorkspaceValue };

const StudioWorkspaceContext = createContext<StudioWorkspaceValue | undefined>(undefined);

export function StudioWorkspaceProvider({ children }: { children: ReactNode }) {
  const { active, v, focus, zParam, lens, setParams } = useStudioViewState();
  const { has, user } = useAuth();

  // ─── Draft editing state (ST4) ───
  const canManage = has('studio.manage');

  const {
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
  } = useStudioGraphData({ active, v, canManage });

  // Editing forces L1 (the canvas is the only editable surface). Otherwise the
  // URL zoom stands on its own: a cold `?z=2` without `?focus` still lands on
  // L2 — the station pane renders a "pick a node" empty state — so deep links
  // are reproducible rather than silently demoted to L1.
  const z: StudioZoom = editing ? 1 : zParam;

  const {
    onGraphChange,
    onAddNode,
    onUpdateNodeConfig,
    onDeleteNode,
    onAddAnnotation,
    onMoveAnnotation,
    onUpdateAnnotationText,
    onDeleteAnnotation,
  } = useStudioGraphMutations({
    focus,
    paletteByType,
    setDraftNodes,
    setDraftEdges,
    setDraftAnnotations,
    setParams,
    markDirty,
  });

  const { createDraft, saveDraft, publish, discardDraft, importTemplate } = useStudioPublish({
    definitionId,
    dirty,
    draftNodes,
    draftEdges,
    draftAnnotations,
    setDirty,
    setBusy,
    setActionError,
    setReloadNonce,
    setImportingTemplateId,
    setParams,
  });

  const {
    live,
    liveNodes,
    flowEdges,
    flowData,
    flowLoading,
    peopleData,
    peopleNodes,
    peopleLoading,
  } = useStudioLensState({ active, v, lens, editing, graph, organizationId: user?.organizationId });

  const { station, stationLoading, reloadStation } = useStudioStation({ active, z, focus });

  const focusedNode = useMemo(() => nodes.find((n) => n.id === focus) ?? null, [nodes, focus]);

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
