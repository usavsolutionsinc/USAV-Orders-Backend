'use client';

/**
 * Sidebar for /admin?section=architecture — picker for the codebase-visualizer
 * diagrams. Hits the same /api/architecture endpoint the main pane uses,
 * filters by search, and drives selection via `?diagram=<key>`.
 *
 * URL-state contract:
 *   ?search=<q>        — search box value
 *   ?diagram=<key>     — currently-selected diagram (read by ArchitectureTab)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminSidebarShell, AdminPickerRow, useAdminUrlState } from './shared';

type DiagramPayload = { title: string; description: string; mermaid: string };
type Manifest = {
  generated_at: string;
  project_name: string;
  files_scanned: number;
  git_head: string;
};
type ArchitectureResponse =
  | { ok: true; manifest: Manifest; diagrams: Record<string, DiagramPayload> }
  | { ok: false; reason: string; hint?: string };

interface DiagramRow {
  key: string;
  title: string;
  description: string;
}

export function ArchitectureSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const selected = searchParams.get('diagram') ?? '';

  const [rows, setRows] = useState<DiagramRow[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/architecture', { cache: 'no-store' });
      const data = (await r.json()) as ArchitectureResponse;
      if (!data.ok) {
        setErr(data.hint || data.reason || 'Diagrams not generated yet.');
        setRows([]);
        setManifest(null);
        return;
      }
      const list: DiagramRow[] = Object.entries(data.diagrams).map(([key, d]) => ({
        key,
        title: d.title,
        description: d.description,
      }));
      setRows(list);
      setManifest(data.manifest);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('admin-architecture-refresh', handler);
    return () => window.removeEventListener('admin-architecture-refresh', handler);
  }, [refresh]);

  // Auto-select first diagram if none selected.
  useEffect(() => {
    if (!selected && rows.length > 0) {
      setParam((p) => p.set('diagram', rows[0].key));
    }
  }, [selected, rows, setParam]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <AdminSidebarShell
      search={{
        value: search,
        onChange: (v) =>
          setParam((p) => {
            if (v.trim()) p.set('search', v.trim());
            else p.delete('search');
          }),
        onClear: () => setParam((p) => p.delete('search')),
        placeholder: 'Search diagrams',
        variant: 'blue',
      }}
      stats={
        manifest ? (
          <div className="flex w-full flex-col gap-0.5">
            <p className="text-micro font-bold uppercase tracking-wider text-gray-500">
              {manifest.files_scanned.toLocaleString()} files · {manifest.git_head.slice(0, 7)}
            </p>
            <p className="text-micro text-gray-400">Generated {manifest.generated_at}</p>
          </div>
        ) : null
      }
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-label font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          Refresh diagrams
        </button>
      }
    >
      {loading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading diagrams…</div>
      ) : err ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No matches.</div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((row) => (
            <li key={row.key}>
              <AdminPickerRow
                selected={selected === row.key}
                onPick={() => setParam((p) => p.set('diagram', row.key))}
                title={row.title}
                subtitle={row.key}
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
