'use client';

/**
 * StationSlot — the mount point that makes a station page composable.
 *
 * Drop `<StationSlot pageKey="receiving" modeKey="incoming" slot="queue" />`
 * into a mode panel and it renders whatever blocks the published
 * station_definitions config places in that slot (nothing, for pages that
 * were never customized — the legacy tree around it keeps rendering as the
 * explicit escape hatch).
 *
 * For holders of `stations.manage` it also carries the whole edit loop, the
 * same affordance ladder as the rail edit-mode pencil escalated one level:
 * pencil → live edit mode (slot outline, per-block ⚙/✕/↑↓) → "+ Add block"
 * palette → Config Sheet → Save draft / Publish. The page stays LIVE while
 * editing — blocks render real data from the draft config as you compose.
 */

import React, { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { Button, IconButton } from '@/design-system/primitives';
import { GripVertical, Pencil, Plus, Settings, X } from '@/components/Icons';
import { getBlock } from '@/lib/stations';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { BlockInstanceConfig, SlotId, StationConfig } from '@/lib/stations/contract';
import {
  stationDefinitionsQuery,
  invalidateStationDefinitions,
} from '@/lib/queries/station-queries';
import { DndContext, closestCenter } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BlockRenderer } from './BlockRenderer';
import { BlockPaletteOverlay } from './BlockPaletteOverlay';
import { BlockConfigSheet } from './BlockConfigSheet';
import { StationIcon } from './station-icons';
import { slotInstances, useStationEditor } from './useStationEditor';

// ── Sortable block row (edit mode only) ──────────────────────────────────────

interface SortableBlockRowProps {
  inst: BlockInstanceConfig;
  onConfigure: (inst: BlockInstanceConfig) => void;
  onRemove: (id: string) => void;
}

function SortableBlockRow({ inst, onConfigure, onRemove }: SortableBlockRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: inst.id });
  const blockDef = getBlock(inst.block);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-md bg-surface-card ring-1 ring-border-soft">
      <div className="flex items-center gap-1.5 border-b border-border-hairline px-2 py-1">
        {/* ds-raw-button: dnd-kit drag handle — spreads {...attributes}/{...listeners} and owns cursor-grab/active:cursor-grabbing semantics, not a standard icon action */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="flex-shrink-0 cursor-grab text-text-faint transition hover:text-text-soft active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <StationIcon name={blockDef?.icon ?? 'Box'} className="h-3.5 w-3.5 text-text-faint" />
        <span className="flex-1 truncate text-mini font-bold text-text-muted">
          {blockDef?.label ?? inst.block}
        </span>
        <HoverTooltip label="Configure source, display & actions" asChild>
          <IconButton
            onClick={() => onConfigure(inst)}
            ariaLabel="Configure source, display & actions"
            className="rounded p-0.5 hover:bg-surface-sunken hover:text-text-muted"
            icon={<Settings className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
        <HoverTooltip label="Remove block" asChild>
          <IconButton
            onClick={() => onRemove(inst.id)}
            ariaLabel="Remove block"
            className="rounded p-0.5 hover:bg-red-50 hover:text-red-600"
            icon={<X className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
      </div>
      <BlockRenderer instance={inst} />
    </div>
  );
}

interface StationSlotProps {
  pageKey: string;
  modeKey: string;
  slot: SlotId;
  /** Label used when the first draft for this mode is created. */
  stationLabel: string;
}

export function StationSlot({ pageKey, modeKey, slot, stationLabel }: StationSlotProps) {
  const { has } = useAuth();
  const queryClient = useQueryClient();
  const canManage = has('stations.manage');

  const { data } = useQuery(stationDefinitionsQuery(pageKey));
  const active = data?.definitions.find((d) => d.modeKey === modeKey);
  const serverDraft = data?.drafts.find((d) => d.modeKey === modeKey);

  // ── Persistence: the page-bound /api/stations endpoints ─────────────────────
  const getBaseConfig = useCallback(
    (): StationConfig => serverDraft?.config ?? active?.config ?? { slots: {} },
    [serverDraft, active],
  );

  const onSaveDraft = useCallback(
    async (config: StationConfig): Promise<number | null> => {
      const res = await fetch('/api/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          modeKey,
          label: serverDraft?.label ?? active?.label ?? stationLabel,
          config,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const issue = json?.issues?.[0]?.message;
        throw new Error(issue || json?.error || `Save failed (${res.status})`);
      }
      invalidateStationDefinitions(queryClient, pageKey);
      return json.draft?.id ?? null;
    },
    [pageKey, modeKey, serverDraft, active, stationLabel, queryClient],
  );

  const onPublish = useCallback(
    async (draftId: number): Promise<boolean> => {
      const res = await fetch('/api/stations/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const issue = json?.issues?.[0]?.message;
        throw new Error(issue || json?.error || `Publish failed (${res.status})`);
      }
      invalidateStationDefinitions(queryClient, pageKey);
      toast.success('Station published — staff pick it up on their next visit.');
      return true;
    },
    [queryClient, pageKey],
  );

  const editor = useStationEditor({ slot, getBaseConfig, onSaveDraft, onPublish });
  const {
    editing,
    saving,
    publishing,
    paletteOpen,
    configuring,
    sortableIds,
    sensors,
    enterEdit,
    exitEdit,
    openPalette,
    closePalette,
    setConfiguring,
    addBlock,
    applyInstance,
    removeInstance,
    onDragEnd,
    saveDraft,
    publish,
  } = editor;

  // ── Render ────────────────────────────────────────────────────────────────
  // While editing, render the working copy; otherwise the live (active) config.
  const instances = useMemo(
    () => (editing ? editor.instances : slotInstances(active?.config, slot)),
    [editing, editor.instances, active, slot],
  );

  // Nothing configured and the viewer can't customize → invisible mount.
  if (!editing && instances.length === 0 && !canManage) return null;

  return (
    <section
      aria-label={`${stationLabel} blocks`}
      className={editing ? 'rounded-lg border border-dashed border-blue-300 bg-blue-50/20' : ''}
    >
      {/* Section header: eyebrow + pencil. Hidden entirely for plain viewers
          when there's nothing to show. */}
      {(editing || instances.length > 0 || canManage) && (
        <div className="flex items-center justify-between px-2.5 pt-2">
          <span className="text-eyebrow font-black uppercase tracking-wider text-text-faint">
            {editing ? `Blocks · editing (${slot})` : instances.length > 0 ? 'Blocks' : ''}
          </span>
          {canManage && !editing ? (
            <HoverTooltip label="Customize this station's blocks" asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={enterEdit}
                ariaLabel="Customize this station's blocks"
                icon={<Pencil className="h-3 w-3" />}
                className="text-text-faint hover:bg-surface-sunken hover:text-text-muted"
              >
                {instances.length === 0 ? 'Customize' : null}
              </Button>
            </HoverTooltip>
          ) : null}
          {editing ? (
            <HoverTooltip label="Exit edit mode" asChild>
              <IconButton
                onClick={exitEdit}
                ariaLabel="Exit edit mode"
                className="rounded-md p-1 hover:bg-surface-sunken hover:text-text-muted"
                icon={<X className="h-3.5 w-3.5" />}
              />
            </HoverTooltip>
          ) : null}
        </div>
      )}

      <div className="space-y-2 px-1 pb-1">
        {editing ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {instances.map((inst) => (
                <SortableBlockRow
                  key={inst.id}
                  inst={inst}
                  onConfigure={setConfiguring}
                  onRemove={removeInstance}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          instances.map((inst) => (
            <div key={inst.id}>
              <BlockRenderer instance={inst} />
            </div>
          ))
        )}

        {editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={openPalette}
            icon={<Plus className="h-3.5 w-3.5" />}
            className="w-full border border-dashed border-border-default bg-surface-card text-text-soft hover:border-blue-400 hover:text-blue-600"
          >
            Add block
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex items-center justify-end gap-2 border-t border-dashed border-blue-200 px-2.5 py-2">
          <Button variant="secondary" size="sm" onClick={() => void saveDraft()} disabled={saving || publishing} loading={saving}>
            Save draft
          </Button>
          <Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} loading={publishing}>
            Publish
          </Button>
        </div>
      ) : null}

      <BlockPaletteOverlay
        open={paletteOpen}
        slot={slot}
        onClose={closePalette}
        onPick={addBlock}
      />
      <BlockConfigSheet
        open={configuring != null}
        instance={configuring}
        onClose={() => setConfiguring(null)}
        onApply={applyInstance}
      />
    </section>
  );
}
