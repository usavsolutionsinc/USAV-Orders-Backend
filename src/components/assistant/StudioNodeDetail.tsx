'use client';

/**
 * Studio focused-node detail, hosted in the assistant dock (universal-feed
 * plan §-2.1 / §4 — "the assistant dock absorbs StudioInspector"). Renders the
 * focused node's identity, live occupancy, ports, and read-only config beneath
 * the chat when the user is on /studio.
 *
 * Structural editing (add/remove/wire nodes, rules) goes through chat now, so
 * this pane keeps only READ + a micro-tweak: the config dump plus, on a draft,
 * the existing NodeConfigForm for a single field (the underlying editing code
 * is unchanged — this just relocates the surface). Reuses the global Studio
 * workspace (the dock is inside StudioWorkspaceProvider).
 */

import { useStudioWorkspace } from '@/components/studio/StudioWorkspaceContext';
import { NodeConfigForm } from '@/components/studio/NodeConfigForm';
import { cn } from '@/utils/_cn';

export function StudioNodeDetail() {
  const studio = useStudioWorkspace();
  if (!studio.active) return null;

  const node = studio.focusedNode;

  if (!node) {
    return (
      <div className="border-t border-border-hairline px-4 py-3">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Studio</p>
        <p className="mt-1 text-micro leading-5 text-text-faint">
          {studio.isDraft ? 'Editing a draft.' : 'Viewing the live graph.'} Ask me to change it, or click a node to
          inspect it here.
        </p>
      </div>
    );
  }

  const meta = node.meta;
  const occupancy = studio.liveNodes?.[node.id];
  const ports = meta?.outputs ?? [];
  const configSchema = studio.palette.find((p) => p.type === node.type)?.configSchema ?? null;
  const editable = studio.editing;

  return (
    <div className="border-t border-border-hairline px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Node</p>
        {occupancy ? (
          <span className="text-mini font-black uppercase tracking-widest text-blue-600">
            {occupancy.total} in flight
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 space-y-1">
        <p className="truncate text-caption font-bold text-text-default">{meta?.label ?? node.type}</p>
        <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
          {node.type}
          {meta?.category ? ` · ${meta.category}` : ''}
        </p>
      </div>

      {ports.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {ports.map((p) => (
            <span
              key={p.id}
              className="rounded bg-surface-canvas px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-soft"
            >
              {p.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Micro-tweak: a single config field on a draft (structural edits go via
          chat). Reuses the same NodeConfigForm + onUpdateNodeConfig seam. */}
      {editable && configSchema ? (
        <div className={cn('mt-3 max-h-64 overflow-y-auto rounded-lg border border-border-hairline bg-surface-canvas/50 p-2')}>
          <p className="mb-1.5 text-mini font-black uppercase tracking-widest text-text-faint">Config (draft)</p>
          <NodeConfigForm
            nodeId={node.id}
            schema={configSchema}
            config={node.config}
            onChange={studio.onUpdateNodeConfig}
          />
        </div>
      ) : Object.keys(node.config).length > 0 ? (
        <dl className="mt-3 space-y-0.5">
          {Object.entries(node.config)
            .slice(0, 6)
            .map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 text-micro">
                <dt className="truncate font-semibold uppercase tracking-widest text-text-faint">{k}</dt>
                <dd className="truncate text-text-muted">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
        </dl>
      ) : null}
    </div>
  );
}
