'use client';

/**
 * useStationEditor — the headless core of the station builder's edit loop,
 * extracted from StationSlot so the SAME drag/config/save/publish state machine
 * drives two chromes:
 *   • StationSlot           — page-bound stations (/api/stations), in-page edit.
 *   • StudioNodeStationEditor — node-bound stations (Operations Studio L2,
 *     /api/studio/nodes/[id]/station), bound to a workflow_node_id.
 *
 * It owns ONLY the composition state + block mutations (add / configure / move /
 * remove / reorder) for one slot, plus the save/publish orchestration. It is
 * deliberately PERSISTENCE-AGNOSTIC: the chrome injects `onSaveDraft(config)`
 * and `onPublish(draftId)` so this hook never knows which API it writes to. The
 * dnd-kit sensors + onDragEnd live here too so neither chrome re-implements them.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { toast } from '@/lib/toast';
import type { BlockInstanceConfig, SlotId, StationConfig } from '@/lib/stations/contract';

export function slotInstances(config: StationConfig | undefined, slot: SlotId): BlockInstanceConfig[] {
  if (!config || config.slots === 'legacy') return [];
  return config.slots[slot] ?? [];
}

function newInstanceId(): string {
  return `blk_${Math.random().toString(36).slice(2, 8)}`;
}

export interface StationEditorPersistence {
  /** Persist the draft; resolves the saved draft row id (null on failure). */
  onSaveDraft: (config: StationConfig) => Promise<number | null>;
  /** Activate a saved draft id; resolves true on success. */
  onPublish: (draftId: number) => Promise<boolean>;
}

export interface UseStationEditorArgs extends StationEditorPersistence {
  slot: SlotId;
  /** Build the working copy when edit mode opens (latest draft ?? active ?? empty). */
  getBaseConfig: () => StationConfig;
  /** Fired after a successful publish so the chrome can refetch + toast. */
  onPublished?: () => void;
}

export interface StationEditorApi {
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  paletteOpen: boolean;
  configuring: BlockInstanceConfig | null;
  instances: BlockInstanceConfig[];
  sortableIds: string[];
  sensors: ReturnType<typeof useSensors>;
  enterEdit: () => void;
  exitEdit: () => void;
  openPalette: () => void;
  closePalette: () => void;
  setConfiguring: (inst: BlockInstanceConfig | null) => void;
  addBlock: (blockType: string) => void;
  applyInstance: (updated: BlockInstanceConfig) => void;
  removeInstance: (id: string) => void;
  moveInstance: (id: string, dir: -1 | 1) => void;
  onDragEnd: (event: DragEndEvent) => void;
  saveDraft: () => Promise<number | null>;
  publish: () => Promise<void>;
}

/**
 * Drives one slot's edit loop. The chrome renders the rows/palette/config-sheet
 * from the returned API; this hook never renders.
 */
export function useStationEditor({
  slot,
  getBaseConfig,
  onSaveDraft,
  onPublish,
  onPublished,
}: UseStationEditorArgs): StationEditorApi {
  const [editing, setEditing] = useState(false);
  const [draftConfig, setDraftConfig] = useState<StationConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [configuring, setConfiguring] = useState<BlockInstanceConfig | null>(null);

  const enterEdit = useCallback(() => {
    setDraftConfig(structuredClone(getBaseConfig()));
    setDirty(false);
    setEditing(true);
  }, [getBaseConfig]);

  const exitEdit = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved block changes?')) return;
    setEditing(false);
    setDraftConfig(null);
    setDirty(false);
    setPaletteOpen(false);
    setConfiguring(null);
  }, [dirty]);

  const patchSlot = useCallback(
    (mutate: (instances: BlockInstanceConfig[]) => BlockInstanceConfig[]) => {
      setDraftConfig((prev) => {
        const base: StationConfig = prev && prev.slots !== 'legacy' ? prev : { slots: {} };
        const slots = base.slots === 'legacy' ? {} : { ...base.slots };
        return { slots: { ...slots, [slot]: mutate(slots[slot] ?? []) } };
      });
      setDirty(true);
    },
    [slot],
  );

  const addBlock = useCallback(
    (blockType: string) => {
      const instance: BlockInstanceConfig = { id: newInstanceId(), block: blockType };
      setPaletteOpen(false);
      patchSlot((list) => [...list, instance]);
      // Dropping never creates a "blank" block — straight into config.
      setConfiguring(instance);
    },
    [patchSlot],
  );

  const applyInstance = useCallback(
    (updated: BlockInstanceConfig) => {
      patchSlot((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    },
    [patchSlot],
  );

  const removeInstance = useCallback(
    (id: string) => patchSlot((list) => list.filter((i) => i.id !== id)),
    [patchSlot],
  );

  const moveInstance = useCallback(
    (id: string, dir: -1 | 1) =>
      patchSlot((list) => {
        const idx = list.findIndex((i) => i.id === id);
        const next = idx + dir;
        if (idx < 0 || next < 0 || next >= list.length) return list;
        const copy = [...list];
        [copy[idx], copy[next]] = [copy[next], copy[idx]];
        return copy;
      }),
    [patchSlot],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      patchSlot((list) => {
        const oldIdx = list.findIndex((i) => i.id === active.id);
        const newIdx = list.findIndex((i) => i.id === over.id);
        if (oldIdx < 0 || newIdx < 0) return list;
        return arrayMove(list, oldIdx, newIdx);
      });
    },
    [patchSlot],
  );

  const saveDraft = useCallback(async (): Promise<number | null> => {
    if (!draftConfig) return null;
    setSaving(true);
    try {
      const id = await onSaveDraft(draftConfig);
      if (id != null) setDirty(false);
      return id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the draft');
      return null;
    } finally {
      setSaving(false);
    }
  }, [draftConfig, onSaveDraft]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const draftId = await saveDraft();
      if (draftId == null) return;
      const ok = await onPublish(draftId);
      if (!ok) return;
      setEditing(false);
      setDraftConfig(null);
      setDirty(false);
      onPublished?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setPublishing(false);
    }
  }, [saveDraft, onPublish, onPublished]);

  const instances = useMemo(
    () => slotInstances(draftConfig ?? undefined, slot),
    [draftConfig, slot],
  );
  const sortableIds = useMemo(() => instances.map((i) => i.id), [instances]);

  return {
    editing,
    dirty,
    saving,
    publishing,
    paletteOpen,
    configuring,
    instances,
    sortableIds,
    sensors,
    enterEdit,
    exitEdit,
    openPalette: () => setPaletteOpen(true),
    closePalette: () => setPaletteOpen(false),
    setConfiguring,
    addBlock,
    applyInstance,
    removeInstance,
    moveInstance,
    onDragEnd,
    saveDraft,
    publish,
  };
}
