'use client';

/**
 * Phase 5 binding editor for one catalog `types` row: pin an optional storefront
 * account (platform_account_id) and an optional workflow-graph node
 * (workflow_node_id, the "own repair-service flow"). Rendered inline under a
 * type row in {@link CatalogManagerList} when `enableTypeBindings` is set (the
 * /settings catalog section), not in the compact label-editor popover.
 *
 * Both selects persist immediately via PATCH /api/catalog/types/[id]; an empty
 * choice clears the binding (sends `null`, which updateType distinguishes from
 * "unchanged"). Read state comes from the passed TypeRow so it reflects the last
 * server value without its own fetch.
 */

import { useState } from 'react';
import { Loader2 } from '@/components/Icons';
import { toast } from '@/lib/toast';
import type { TypeRow } from '@/lib/neon/catalog-queries';
import { usePlatformAccountCatalog, usePlatformCatalog, useWorkflowNodeOptions } from '@/hooks/useCatalog';

const SELECT =
  'w-full rounded-lg border border-border-soft bg-surface-card px-2.5 py-1.5 text-label text-text-default outline-none transition-colors focus:border-blue-500';

export function TypeBindingsEditor({
  type,
  onChanged,
}: {
  type: TypeRow;
  onChanged: () => void;
}) {
  const { rows: platforms } = usePlatformCatalog();
  const { rows: accounts } = usePlatformAccountCatalog();
  const { nodes, isLoading: nodesLoading } = useWorkflowNodeOptions();
  const [busy, setBusy] = useState<'account' | 'workflow' | null>(null);

  const platformLabel = new Map(platforms.map((p) => [p.id, p.label]));

  async function patch(body: Record<string, unknown>, which: 'account' | 'workflow') {
    setBusy(which);
    try {
      const res = await fetch(`/api/catalog/types/${type.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        toast.error(data?.error || `Update failed (${res.status})`);
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1.5 grid grid-cols-1 gap-2 rounded-lg border border-dashed border-border-soft bg-surface-canvas p-2.5 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Storefront account
          {busy === 'account' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </span>
        <select
          className={SELECT}
          value={type.platform_account_id ?? ''}
          disabled={busy != null}
          onChange={(e) =>
            patch({ platformAccountId: e.target.value ? Number(e.target.value) : null }, 'account')
          }
        >
          <option value="">— None (platform-agnostic) —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {platformLabel.get(a.platform_id) ?? '?'} · {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-eyebrow font-black uppercase tracking-widest text-text-faint">
          Workflow node
          {busy === 'workflow' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </span>
        <select
          className={SELECT}
          value={type.workflow_node_id ?? ''}
          disabled={busy != null || nodesLoading}
          onChange={(e) => patch({ workflowNodeId: e.target.value || null }, 'workflow')}
        >
          <option value="">— None (no custom flow) —</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.definitionName ? `${n.definitionName} · ` : ''}
              {n.label}
            </option>
          ))}
          {/* Preserve a stale binding that's no longer in the active definition. */}
          {type.workflow_node_id && !nodes.some((n) => n.id === type.workflow_node_id) ? (
            <option value={type.workflow_node_id}>{type.workflow_node_id} (unavailable)</option>
          ) : null}
        </select>
      </label>
    </div>
  );
}
