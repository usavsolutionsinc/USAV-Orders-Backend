'use client';

/**
 * BlockRenderer — mounts one configured block instance: resolves its
 * registered definition, fetches its bound data source, binds its actions
 * (permission-filtered to the viewer), and lazy-loads the block component.
 *
 * Permission model (station-builder-ui-plan §2.4): a viewer who lacks a
 * block's required permissions or its source's read permission doesn't get
 * the block at all; a viewer who holds those but lacks some bound-action
 * permission just doesn't see that button. The builder never grants — it
 * only selects among existing withAuth-gated routes.
 */

import { lazy, Suspense, useMemo, useRef, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getBlock,
  getDataSource,
  getAction,
} from '@/lib/stations';
import type {
  BlockInstanceConfig,
  BlockProps,
  BoundAction,
  FieldKind,
  SourceRow,
} from '@/lib/stations/contract';
import { stationSourceQuery, invalidateStationSource } from '@/lib/queries/station-queries';

const componentCache = new Map<string, ComponentType<BlockProps>>();

function useLazyBlockComponent(type: string): ComponentType<BlockProps> | null {
  const ref = useRef<ComponentType<BlockProps> | null>(componentCache.get(type) ?? null);
  if (!ref.current) {
    const def = getBlock(type);
    if (!def) return null;
    const Lazy = lazy(() => def.component().then((C) => ({ default: C })));
    componentCache.set(type, Lazy as ComponentType<BlockProps>);
    ref.current = Lazy as ComponentType<BlockProps>;
  }
  return ref.current;
}

export function BlockRenderer({ instance }: { instance: BlockInstanceConfig }) {
  const { has } = useAuth();
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<{ actionId: string; rowId: string } | null>(null);

  const block = getBlock(instance.block);
  const source = instance.source ? getDataSource(instance.source.id) : undefined;
  const filters = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    for (const f of source?.filters ?? []) {
      if (f.default !== undefined) defaults[f.key] = f.default;
    }
    return { ...defaults, ...(instance.source?.filters ?? {}) };
  }, [source, instance.source?.filters]);

  const sourceUrl = source ? source.buildUrl(filters) : null;
  const canReadSource = source ? has(source.permission) : true;
  const blockPermitted = (block?.requiredPermissions ?? []).every((p) => has(p));

  const query = useQuery({
    ...stationSourceQuery(source?.id ?? 'none', sourceUrl ?? '', filters),
    enabled: Boolean(source && sourceUrl && canReadSource && blockPermitted),
  });

  const rows: SourceRow[] = useMemo(() => {
    if (!source || query.data == null) return [];
    try {
      return source.parse(query.data, filters);
    } catch {
      return [];
    }
  }, [source, query.data, filters]);

  const fieldKinds: Record<string, FieldKind> = useMemo(
    () => Object.fromEntries((source?.shape ?? []).map((f) => [f.key, f.kind])),
    [source],
  );

  const actions: BoundAction[] = useMemo(() => {
    return (instance.actions ?? [])
      .map((id) => getAction(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .filter((a) => has(a.permission))
      .map((a) => ({
        def: (({ body: _body, ...meta }) => meta)(a),
        pendingRowId:
          pendingAction?.actionId === a.id ? pendingAction.rowId : null,
        run: async (row: SourceRow) => {
          setPendingAction({ actionId: a.id, rowId: row.id });
          try {
            const res = await fetch(a.endpoint.path.replace(':id', encodeURIComponent(row.id)), {
              method: a.endpoint.method,
              headers: { 'Content-Type': 'application/json' },
              body: a.body ? JSON.stringify(a.body(row)) : undefined,
            });
            if (!res.ok) {
              const json = await res.json().catch(() => null);
              throw new Error(json?.error || `${a.label} failed (${res.status})`);
            }
            if (source) invalidateStationSource(queryClient, source.id);
            return true;
          } catch (err) {
            toast.error(err instanceof Error ? err.message : `${a.label} failed`);
            return false;
          } finally {
            setPendingAction(null);
          }
        },
      }));
  }, [instance.actions, has, pendingAction, source, queryClient]);

  const Component = useLazyBlockComponent(instance.block);

  // Unknown block type (removed from code since publish) or a viewer without
  // the needed permissions: render nothing, never crash the station.
  if (!block || !Component || !blockPermitted || (source && !canReadSource)) return null;

  return (
    <Suspense fallback={<div className="h-10 animate-pulse rounded bg-gray-50" />}>
      <Component
        rows={rows}
        isLoading={query.isLoading}
        mapping={instance.source?.fields ?? {}}
        fieldKinds={fieldKinds}
        display={instance.display ?? {}}
        actions={actions}
        doneWhen={instance.done_when ?? null}
      />
    </Suspense>
  );
}
