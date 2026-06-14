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

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/design-system/primitives';
import { Pencil, Plus, Settings, X, ChevronUp, ChevronDown } from '@/components/Icons';
import { getBlock } from '@/lib/stations';
import type { BlockInstanceConfig, SlotId, StationConfig } from '@/lib/stations/contract';
import {
  stationDefinitionsQuery,
  invalidateStationDefinitions,
} from '@/lib/queries/station-queries';
import { BlockRenderer } from './BlockRenderer';
import { BlockPaletteOverlay } from './BlockPaletteOverlay';
import { BlockConfigSheet } from './BlockConfigSheet';
import { StationIcon } from './station-icons';

interface StationSlotProps {
  pageKey: string;
  modeKey: string;
  slot: SlotId;
  /** Label used when the first draft for this mode is created. */
  stationLabel: string;
}

function slotInstances(config: StationConfig | undefined, slot: SlotId): BlockInstanceConfig[] {
  if (!config || config.slots === 'legacy') return [];
  return config.slots[slot] ?? [];
}

function newInstanceId(): string {
  return `blk_${Math.random().toString(36).slice(2, 8)}`;
}

export function StationSlot({ pageKey, modeKey, slot, stationLabel }: StationSlotProps) {
  const { has } = useAuth();
  const queryClient = useQueryClient();
  const canManage = has('stations.manage');

  const { data } = useQuery(stationDefinitionsQuery(pageKey));
  const active = data?.definitions.find((d) => d.modeKey === modeKey);
  const serverDraft = data?.drafts.find((d) => d.modeKey === modeKey);

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draftConfig, setDraftConfig] = useState<StationConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [configuring, setConfiguring] = useState<BlockInstanceConfig | null>(null);

  const enterEdit = useCallback(() => {
    const base = serverDraft?.config ?? active?.config ?? { slots: {} };
    setDraftConfig(structuredClone(base));
    setDirty(false);
    setEditing(true);
  }, [serverDraft, active]);

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

  const saveDraft = useCallback(async (): Promise<number | null> => {
    if (!draftConfig) return null;
    setSaving(true);
    try {
      const res = await fetch('/api/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          modeKey,
          label: serverDraft?.label ?? active?.label ?? stationLabel,
          config: draftConfig,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const issue = json?.issues?.[0]?.message;
        throw new Error(issue || json?.error || `Save failed (${res.status})`);
      }
      setDirty(false);
      invalidateStationDefinitions(queryClient, pageKey);
      return json.draft?.id ?? null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the draft');
      return null;
    } finally {
      setSaving(false);
    }
  }, [draftConfig, pageKey, modeKey, serverDraft, active, stationLabel, queryClient]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const draftId = await saveDraft();
      if (draftId == null) return;
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
      setEditing(false);
      setDraftConfig(null);
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setPublishing(false);
    }
  }, [saveDraft, queryClient, pageKey]);

  // ── Render ────────────────────────────────────────────────────────────────
  const instances = useMemo(
    () => (editing ? slotInstances(draftConfig ?? undefined, slot) : slotInstances(active?.config, slot)),
    [editing, draftConfig, active, slot],
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
          <span className="text-eyebrow font-black uppercase tracking-wider text-gray-400">
            {editing ? `Blocks · editing (${slot})` : instances.length > 0 ? 'Blocks' : ''}
          </span>
          {canManage && !editing ? (
            <button
              type="button"
              onClick={enterEdit}
              title="Customize this station's blocks"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-mini font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Pencil className="h-3 w-3" />
              {instances.length === 0 ? 'Customize' : null}
            </button>
          ) : null}
          {editing ? (
            <button
              type="button"
              onClick={exitEdit}
              title="Exit edit mode"
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}

      <div className="space-y-2 px-1 pb-1">
        {instances.map((inst, idx) => {
          const blockDef = getBlock(inst.block);
          return (
            <div
              key={inst.id}
              className={editing ? 'rounded-md bg-white ring-1 ring-gray-200' : ''}
            >
              {editing ? (
                <div className="flex items-center gap-1.5 border-b border-gray-100 px-2 py-1">
                  <StationIcon name={blockDef?.icon ?? 'Box'} className="h-3.5 w-3.5 text-gray-400" />
                  <span className="flex-1 truncate text-mini font-bold text-gray-600">
                    {blockDef?.label ?? inst.block}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveInstance(inst.id, -1)}
                    disabled={idx === 0}
                    title="Move up"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveInstance(inst.id, 1)}
                    disabled={idx === instances.length - 1}
                    title="Move down"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfiguring(inst)}
                    title="Configure source, display & actions"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeInstance(inst.id)}
                    title="Remove block"
                    className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              <BlockRenderer instance={inst} />
            </div>
          );
        })}

        {editing ? (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-white px-2 py-2 text-caption font-bold text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600"
          >
            <Plus className="h-3.5 w-3.5" /> Add block
          </button>
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
        onClose={() => setPaletteOpen(false)}
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
