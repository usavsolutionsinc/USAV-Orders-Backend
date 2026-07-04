'use client';

/**
 * StudioNodeStationEditor — the EDITABLE L2 station pane (Operations Studio
 * Phase D / ST5).
 *
 * The read-only L2 preview (StudioStationPreview) shows a node's bound station;
 * this is its editable twin for `studio.manage` holders. It reuses the SAME
 * headless edit core as the page-bound StationSlot (useStationEditor) and the
 * SAME registry-driven palette + config sheet, but persists to the NODE-scoped
 * endpoints (PUT /api/studio/nodes/[id]/station + .../publish) — binding the
 * composition to this node's workflow_node_id. No chrome is duplicated: the
 * draft/publish buttons live here, the block state machine lives in the hook.
 *
 * The editor edits the `queue` slot — the slot the one shipped block (Checklist)
 * occupies, and the canonical worklist slot a node-bound station fills. Other
 * slots stay read-only in the preview until more blocks register for them.
 *
 * When the node has no station yet, an owner gets an empty editable queue and
 * the first save BINDS a fresh station_definition to this node.
 */

import { useCallback } from 'react';
import { toast } from '@/lib/toast';
import { icons } from 'lucide-react';
import { Button, IconButton } from '@/design-system/primitives';
import { GripVertical, Plus, Settings, X } from '@/components/Icons';
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getBlock } from '@/lib/stations';
import type { BlockInstanceConfig, StationConfig } from '@/lib/stations/contract';
import { BlockRenderer } from '@/components/stations/BlockRenderer';
import { BlockPaletteOverlay } from '@/components/stations/BlockPaletteOverlay';
import { BlockConfigSheet } from '@/components/stations/BlockConfigSheet';
import { StationIcon } from '@/components/stations/station-icons';
import { useStationEditor } from '@/components/stations/useStationEditor';
import type { StudioGraphNode, StudioStationView } from './studio-types';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

const EDIT_SLOT = 'queue' as const;

// ── Sortable block row (edit mode) — mirrors StationSlot's, slate-toned ──────

function SortableBlockRow({
  inst,
  onConfigure,
  onRemove,
}: {
  inst: BlockInstanceConfig;
  onConfigure: (inst: BlockInstanceConfig) => void;
  onRemove: (id: string) => void;
}) {
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
        <IconButton
          {...attributes}
          {...listeners}
          ariaLabel="Drag to reorder"
          className="flex-shrink-0 cursor-grab text-text-faint hover:text-text-soft active:cursor-grabbing"
          icon={<GripVertical className="h-3.5 w-3.5" />}
        />
        <StationIcon name={blockDef?.icon ?? 'Box'} className="h-3.5 w-3.5 text-text-faint" />
        <span className="flex-1 truncate text-mini font-bold text-text-muted">
          {blockDef?.label ?? inst.block}
        </span>
        <HoverTooltip label="Configure source, display & actions" asChild>
          <IconButton
            onClick={() => onConfigure(inst)}
            ariaLabel="Configure source, display & actions"
            className="rounded p-0.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
            icon={<Settings className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
        <HoverTooltip label="Remove block" asChild>
          <IconButton
            onClick={() => onRemove(inst.id)}
            ariaLabel="Remove block"
            className="rounded p-0.5 text-text-faint hover:bg-rose-50 hover:text-rose-600"
            icon={<X className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
      </div>
      <BlockRenderer instance={inst} />
    </div>
  );
}

export function StudioNodeStationEditor({
  node,
  station,
  onBack,
  reloadStation,
}: {
  node: StudioGraphNode;
  station: StudioStationView | null;
  onBack: () => void;
  reloadStation: () => void;
}) {
  const nodeId = node.id;
  const nodeLabel = node.meta?.label ?? node.type ?? 'Step';

  const getBaseConfig = useCallback(
    (): StationConfig => station?.config ?? { slots: {} },
    [station],
  );

  const onSaveDraft = useCallback(
    async (config: StationConfig): Promise<number | null> => {
      const res = await fetch(`/api/studio/nodes/${encodeURIComponent(nodeId)}/station`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: station?.label ?? `${nodeLabel} · station`, config }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const issue = json?.issues?.[0]?.message;
        throw new Error(issue || json?.error || `Save failed (${res.status})`);
      }
      return json.draft?.id ?? null;
    },
    [nodeId, nodeLabel, station],
  );

  const onPublish = useCallback(
    async (draftId: number): Promise<boolean> => {
      const res = await fetch(`/api/studio/nodes/${encodeURIComponent(nodeId)}/station/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const issue = json?.issues?.[0]?.message;
        throw new Error(issue || json?.error || `Publish failed (${res.status})`);
      }
      toast.success('Station published — bound to this step. Staff pick it up on their next visit.');
      return true;
    },
    [nodeId],
  );

  const e = useStationEditor({
    slot: EDIT_SLOT,
    getBaseConfig,
    onSaveDraft,
    onPublish,
    onPublished: reloadStation,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      {/* Sub-header: back + context + edit toggle */}
      <div className="flex items-center gap-3 border-b border-border-soft bg-surface-card px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-text-muted hover:bg-surface-sunken"
          icon={<icons.ArrowLeft />}
        >
          Flow
        </Button>
        <span className="text-text-faint">/</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-text-default">
            {station?.label ?? `${nodeLabel} · station`}
          </p>
          <p className="truncate text-caption text-text-faint">
            {station
              ? `${station.pageKey} · ${station.modeKey} · v${station.version}`
              : `binds to “${nodeLabel}”`}
          </p>
        </div>
        {!e.editing ? (
          <Button
            variant="brand"
            size="sm"
            onClick={e.enterEdit}
            className="ml-auto"
            icon={<icons.Pencil />}
          >
            {station ? 'Edit station' : 'Bind a station'}
          </Button>
        ) : (
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-amber-700">
            Editing draft
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">
          <section
            className={
              e.editing ? 'rounded-lg border border-dashed border-blue-300 bg-blue-50/30 p-2' : ''
            }
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <h3 className="text-micro font-bold uppercase tracking-wider text-text-faint">
                Queue{e.editing ? ' · editing' : ''}
              </h3>
              {e.editing ? (
                <HoverTooltip label="Exit edit mode" asChild>
                  <IconButton
                    onClick={e.exitEdit}
                    ariaLabel="Exit edit mode"
                    className="rounded p-1 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
                    icon={<X className="h-3.5 w-3.5" />}
                  />
                </HoverTooltip>
              ) : null}
            </div>

            {e.instances.length === 0 && !e.editing ? (
              <div className="rounded-xl border border-dashed border-border-soft bg-surface-card px-4 py-6 text-center text-xs text-text-soft">
                No blocks in this station yet. Click “{station ? 'Edit station' : 'Bind a station'}” to compose it.
              </div>
            ) : (
              <div className="space-y-2">
                {e.editing ? (
                  <DndContext sensors={e.sensors} collisionDetection={closestCenter} onDragEnd={e.onDragEnd}>
                    <SortableContext items={e.sortableIds} strategy={verticalListSortingStrategy}>
                      {e.instances.map((inst) => (
                        <SortableBlockRow
                          key={inst.id}
                          inst={inst}
                          onConfigure={e.setConfiguring}
                          onRemove={e.removeInstance}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  e.instances.map((inst) => (
                    <div key={inst.id} className="rounded-xl border border-border-soft bg-surface-card p-1 shadow-sm">
                      <BlockRenderer instance={inst} />
                    </div>
                  ))
                )}

                {e.editing ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={e.openPalette}
                    className="w-full border border-dashed border-border-default bg-surface-card text-text-soft hover:border-blue-400 hover:text-blue-600"
                    icon={<Plus />}
                  >
                    Add block
                  </Button>
                ) : null}
              </div>
            )}
          </section>

          {/* When not editing, surface the read-only resolved view of the other
              slots so the owner sees the full composition. */}
          {!e.editing && station && station.slots.some((s) => s.slot !== EDIT_SLOT) ? (
            <div className="mt-4 space-y-1">
              {station.slots
                .filter((s) => s.slot !== EDIT_SLOT)
                .map((s) => (
                  <p key={s.slot} className="text-caption text-text-faint">
                    {s.slot}: {s.blocks.map((b) => b.blockLabel).join(', ')} (read-only)
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      </div>

      {e.editing ? (
        <div className="flex items-center justify-end gap-2 border-t border-dashed border-blue-200 bg-surface-card px-4 py-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void e.saveDraft()}
            disabled={e.saving || e.publishing}
            loading={e.saving}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void e.publish()}
            disabled={e.saving || e.publishing}
            loading={e.publishing}
          >
            Publish
          </Button>
        </div>
      ) : null}

      <BlockPaletteOverlay
        open={e.paletteOpen}
        slot={EDIT_SLOT}
        onClose={e.closePalette}
        onPick={e.addBlock}
      />
      <BlockConfigSheet
        open={e.configuring != null}
        instance={e.configuring}
        onClose={() => e.setConfiguring(null)}
        onApply={e.applyInstance}
      />
    </div>
  );
}
