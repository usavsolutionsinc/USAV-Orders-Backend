'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { setNasBaseUrl } from '@/lib/nas-photos';
import { useNasConfig } from '@/hooks/useNasConfig';
import {
  EMPTY_SERVERS,
  EMPTY_TARGETS,
  TARGETS,
  type FolderMap,
  type NasServers,
  type NasStorageTarget,
  type NasStorageTargets,
  type SettingsResponse,
} from './nas-folders-config';

const QUERY_KEY = ['org-station-nas-folders'];

/**
 * Controller for the NAS folders settings tab. Loads the org settings once and
 * exposes three independent edit slices (station picker folders, NAS server
 * addresses, workflow storage targets) — each with its own draft/dirty/save —
 * plus the shared folder-picker `picking` state that bridges the targets +
 * station slices.
 */
export function useStationNasFolders() {
  const queryClient = useQueryClient();
  // Seed the module base URL from the active saved server so Browse targets the
  // currently-active NAS.
  useNasConfig();

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/admin/organization/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: QUERY_KEY }), [queryClient]);

  // ── Station picker folders ──────────────────────────────────────────────
  const [draft, setDraft] = useState<FolderMap>({});
  useEffect(() => {
    if (data?.stationNasPhotoFolders) setDraft(data.stationNasPhotoFolders);
  }, [data]);
  const saved = data?.stationNasPhotoFolders ?? {};
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    for (const k of keys) {
      if ((saved[k] || '') !== (draft[k] || '')) return true;
    }
    return false;
  }, [saved, draft]);
  const setFolder = useCallback((station: string, value: string) => {
    setDraft((prev) => ({ ...prev, [station]: value }));
  }, []);
  const save = useMutation({
    mutationFn: async (folders: FolderMap) => {
      const res = await fetch('/api/admin/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationNasPhotoFolders: folders }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Station folders saved');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  // ── NAS server addresses (test/prod + active) ───────────────────────────
  const [servers, setServers] = useState<NasServers>(EMPTY_SERVERS);
  useEffect(() => {
    if (data?.nasPhotoServers) setServers({ ...EMPTY_SERVERS, ...data.nasPhotoServers });
  }, [data]);
  const savedServers = data?.nasPhotoServers ?? EMPTY_SERVERS;
  const serversDirty =
    (savedServers.test || '') !== (servers.test || '') ||
    (savedServers.prod || '') !== (servers.prod || '') ||
    savedServers.active !== servers.active;
  const saveServers = useMutation({
    mutationFn: async (next: NasServers) => {
      const res = await fetch('/api/admin/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nasPhotoServers: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, next) => {
      // Update the live module base URL so Browse uses the just-saved active
      // server without a page reload.
      setNasBaseUrl(next.active === 'test' ? next.test : next.prod);
      toast.success('NAS address saved');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  // ── Workflow-specific NAS targets ───────────────────────────────────────
  const [targets, setTargets] = useState<NasStorageTargets>(EMPTY_TARGETS);
  useEffect(() => {
    if (data?.nasStorageTargets) {
      setTargets({
        receiving: { ...EMPTY_TARGETS.receiving, ...data.nasStorageTargets.receiving },
        shipping: { ...EMPTY_TARGETS.shipping, ...data.nasStorageTargets.shipping },
        claims: { ...EMPTY_TARGETS.claims, ...data.nasStorageTargets.claims },
      });
    }
  }, [data]);
  const savedTargets = data?.nasStorageTargets ?? EMPTY_TARGETS;
  const targetsDirty = TARGETS.some(
    ({ key }) =>
      (savedTargets[key]?.root || '') !== (targets[key]?.root || '') ||
      (savedTargets[key]?.folder || '') !== (targets[key]?.folder || ''),
  );
  const setTarget = useCallback(
    (key: keyof NasStorageTargets, field: keyof NasStorageTarget, value: string) => {
      setTargets((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    },
    [],
  );
  const saveTargets = useMutation({
    mutationFn: async (next: NasStorageTargets) => {
      const res = await fetch('/api/admin/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nasStorageTargets: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.agentSync && !data.agentSync.ok) {
        toast.warning(`NAS folders saved locally. Office agent sync failed: ${data.agentSync.error}`);
      } else if (data?.agentSync?.ok) {
        toast.success('NAS folders saved and pushed to the office agent');
      } else {
        toast.success('NAS folders saved');
      }
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  // ── Shared folder picker ────────────────────────────────────────────────
  const [picking, setPicking] = useState<string | null>(null); // station key OR `target:<key>`

  return {
    isLoading,
    draft, setFolder, dirty, save,
    servers, setServers, serversDirty, saveServers,
    targets, setTarget, targetsDirty, saveTargets,
    picking, setPicking,
  };
}

export type StationNasFoldersController = ReturnType<typeof useStationNasFolders>;
