'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { listNasDir, nasConfigured, setNasBaseUrl, type NasEntry } from '@/lib/nas-photos';
import { useNasConfig } from '@/hooks/useNasConfig';
import { NasBreadcrumb, NasFolderCard, NasSectionLabel } from '@/components/nas/NasBrowserChrome';

/**
 * Admin → Receiving Photos.
 *
 * Per-station default folder for the NAS photo picker. When an operator on a
 * given station opens "Select from NAS" on a receiving PO, the picker jumps
 * straight to the folder set here (e.g. "JUN 2026") instead of the root, so
 * they don't re-navigate every time. Stored in `organizations.settings
 * .stationNasPhotoFolders`; read back per-operator via their primary station in
 * GET /api/receiving-photos (→ `initialNasFolder`). Photos inside still sort by
 * the PO's scan time.
 */

// "DEFAULT" applies to every operator that has no station-specific folder (and
// to staff with no station assigned at all). The rest mirror staff_stations
// (VALID_STATIONS) for per-station overrides.
const STATIONS: { key: string; label: string; hint: string }[] = [
  { key: 'DEFAULT', label: 'Default (all stations)', hint: 'Used for everyone unless a station below overrides it — set this if you don’t assign stations' },
  { key: 'UNBOX', label: 'Receiving (Unbox)', hint: 'Overrides Default for staff whose primary station is Unbox' },
  { key: 'TECH', label: 'Tech', hint: '' },
  { key: 'PACK', label: 'Packing', hint: '' },
  { key: 'SALES', label: 'Sales', hint: '' },
  { key: 'FBA', label: 'FBA', hint: '' },
];

type FolderMap = Record<string, string>;
type NasServers = { test: string; prod: string; active: 'test' | 'prod' };
const EMPTY_SERVERS: NasServers = { test: '', prod: '', active: 'prod' };

interface SettingsResponse {
  stationNasPhotoFolders: FolderMap;
  nasPhotoServers: NasServers;
}

export function StationNasFoldersTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<FolderMap>({});
  const [picking, setPicking] = useState<string | null>(null); // station key being browsed
  // Seed the module base URL from the active saved server so Browse targets the
  // currently-active NAS.
  useNasConfig();

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ['org-station-nas-folders'],
    queryFn: async () => {
      const res = await fetch('/api/admin/organization/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  // Seed the editable draft once the saved settings arrive.
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
      queryClient.invalidateQueries({ queryKey: ['org-station-nas-folders'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const setFolder = useCallback((station: string, value: string) => {
    setDraft((prev) => ({ ...prev, [station]: value }));
  }, []);

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
      // server without a page reload (useNasConfig is fetched once per load).
      setNasBaseUrl(next.active === 'test' ? next.test : next.prod);
      toast.success('NAS address saved');
      queryClient.invalidateQueries({ queryKey: ['org-station-nas-folders'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-lg font-black text-gray-900">Receiving Photos</h1>
          <p className="mt-1 text-caption text-gray-500">
            Phones write receiving photos straight to the NAS. Set the NAS address below
            (and flip between your testing and production NAS), then set the folder each
            station opens to.
          </p>
        </div>

        {/* ── NAS server address (test / prod + active toggle) ───────────── */}
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-label font-black text-gray-800">NAS address</p>
              <p className="mt-0.5 text-micro text-gray-400">
                Base URL of the NAS file server (Cloudflare-fronted, no trailing slash).
                Photos are written and read against the active one.
              </p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-200">
              {(['test', 'prod'] as const).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setServers((p) => ({ ...p, active: slot }))}
                  className={`px-3 py-1.5 text-micro font-black uppercase tracking-widest transition-colors ${
                    servers.active === slot
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {slot === 'test' ? 'Testing' : 'Production'}
                </button>
              ))}
            </div>
          </div>

          {(['prod', 'test'] as const).map((slot) => (
            <div key={slot} className="flex items-center gap-3">
              <div className="w-24 shrink-0">
                <p className="text-label font-black text-gray-800">
                  {slot === 'prod' ? 'Production' : 'Testing'}
                </p>
                {servers.active === slot ? (
                  <span className="text-micro font-black uppercase tracking-widest text-emerald-600">
                    ● Active
                  </span>
                ) : null}
              </div>
              <input
                type="url"
                inputMode="url"
                value={servers[slot]}
                onChange={(e) => setServers((p) => ({ ...p, [slot]: e.target.value }))}
                placeholder="https://nas.example.com"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          ))}

          <div className="flex items-center justify-end gap-3">
            {serversDirty ? (
              <span className="text-micro font-bold uppercase tracking-widest text-amber-600">
                Unsaved changes
              </span>
            ) : null}
            <button
              type="button"
              disabled={!serversDirty || saveServers.isPending || isLoading}
              onClick={() => saveServers.mutate(servers)}
              className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saveServers.isPending ? 'Saving…' : 'Save address'}
            </button>
          </div>
        </div>

        {!nasConfigured() ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-caption font-semibold text-amber-800">
            No active NAS address is set, so phones can’t save photos and Browse is
            unavailable. Enter the {servers.active === 'test' ? 'Testing' : 'Production'} URL
            above and Save.
          </div>
        ) : null}

        <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {STATIONS.map((s) => (
            <div key={s.key} className="flex items-center gap-3 px-4 py-3">
              <div className="w-36 shrink-0">
                <p className="text-label font-black text-gray-800">{s.label}</p>
                <p className="text-micro font-bold uppercase tracking-widest text-gray-400">{s.key}</p>
              </div>
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={draft[s.key] ?? ''}
                  onChange={(e) => setFolder(s.key, e.target.value)}
                  placeholder="Root (no folder)"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                {s.hint ? <p className="mt-1 text-micro text-gray-400">{s.hint}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {nasConfigured() ? (
                  <button
                    type="button"
                    onClick={() => setPicking(s.key)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
                  >
                    Browse
                  </button>
                ) : null}
                {draft[s.key] ? (
                  <button
                    type="button"
                    onClick={() => setFolder(s.key, '')}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-micro font-black uppercase tracking-widest text-gray-500 hover:bg-gray-50"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          {dirty ? (
            <span className="text-micro font-bold uppercase tracking-widest text-amber-600">
              Unsaved changes
            </span>
          ) : null}
          <button
            type="button"
            disabled={!dirty || save.isPending || isLoading}
            onClick={() => save.mutate(draft)}
            className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {picking ? (
        <FolderPickerModal
          station={STATIONS.find((s) => s.key === picking)?.label ?? picking}
          initialDir={draft[picking] ?? ''}
          onCancel={() => setPicking(null)}
          onPick={(folder) => {
            setFolder(picking, folder);
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Browse the NAS tree and pick a folder. Reuses the same breadcrumb + folder
 * cards as the receiving picker; "Use this folder" returns the current path.
 */
function FolderPickerModal({
  station,
  initialDir,
  onCancel,
  onPick,
}: {
  station: string;
  initialDir: string;
  onCancel: () => void;
  onPick: (folder: string) => void;
}) {
  const [dir, setDir] = useState(() => (initialDir || '').replace(/^\/+|\/+$/g, ''));
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (relDir: string) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listNasDir(relDir));
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Failed to load folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(dir);
  }, [dir, load]);

  const folders = entries.filter((e) => e.type === 'directory');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">
              Pick folder · {station}
            </p>
            <p className="truncate text-sm font-bold text-gray-800">/{dir || 'Root'}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>

        {dir ? (
          <div className="border-b border-gray-100 px-3 py-2">
            <NasBreadcrumb dir={dir} onNavigate={setDir} rootLabel="Root" />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-2xl bg-gray-100" />
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-caption font-bold text-rose-600">{error}</p>
              <button
                type="button"
                onClick={() => void load(dir)}
                className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
              >
                Retry
              </button>
            </div>
          ) : folders.length === 0 ? (
            <p className="py-10 text-center text-caption font-bold uppercase tracking-widest text-gray-400">
              No subfolders here.
            </p>
          ) : (
            <div className="space-y-1.5">
              <NasSectionLabel>Folders · {folders.length}</NasSectionLabel>
              {folders.map((f) => (
                <NasFolderCard key={f.relPath} name={f.name} onOpen={() => setDir(f.relPath)} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <span className="truncate text-micro font-bold uppercase tracking-widest text-gray-400">
            {dir ? `Selecting: /${dir}` : 'At root — pick a subfolder or use root'}
          </span>
          <button
            type="button"
            onClick={() => onPick(dir)}
            className="inline-flex h-9 shrink-0 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}

export default StationNasFoldersTab;
