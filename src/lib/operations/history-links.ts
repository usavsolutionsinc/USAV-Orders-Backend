import type { JourneyDimension } from '@/lib/timeline/journey';
import type { JourneyUrlFilters } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import type { SurfaceEntityType } from '@/lib/surfaces/registry';
import { buildOperationsSignalsHref } from '@/features/signals/signals-url';

/**
 * Cross-link href SoT between Operations → History (Trace) and → Signals
 * (Browse) — plan §7.3. One place builds these URLs so assistant tools, the
 * CommandBar, and UI chips all deep-link identically. Pure (no React/DOM), so
 * it's usable server-side and unit-tested. All type imports are erased at build,
 * and the only runtime import (`buildOperationsSignalsHref`) is itself pure.
 *
 * A `JourneyDimension` value ('order' | 'serial' | 'tracking') is also its URL
 * param name, so the dim doubles as the record-param key.
 */

/** Deep-link into History Trace for one record (`/operations?mode=history&dim=…&<dim>=…`). */
export function operationsHistoryTraceHref(args: {
  dim: JourneyDimension;
  value: string;
  filters?: Partial<JourneyUrlFilters>;
}): string {
  const sp = new URLSearchParams();
  sp.set('mode', 'history');
  sp.set('dim', args.dim);
  const v = args.value.trim();
  if (v) sp.set(args.dim, v); // dim name === record param name
  const f = args.filters;
  if (f) {
    if (f.stations?.length) sp.set('stations', f.stations.join(','));
    if (f.types?.length) sp.set('types', f.types.join(','));
    if (f.sources?.length) sp.set('sources', f.sources.join(','));
    if (f.from) sp.set('from', f.from);
    if (f.until) sp.set('until', f.until);
    if (f.staffId) sp.set('staffId', f.staffId);
    if (f.status) sp.set('status', f.status);
  }
  return `/operations?${sp.toString()}`;
}

/** Deep-link into Signals Browse, optionally scoped to an entity / kind / node. */
export function operationsSignalsBrowseHref(args: {
  entityType?: SurfaceEntityType;
  entityId?: number;
  signalKind?: string;
  nodeId?: string;
}): string {
  return buildOperationsSignalsHref(new URLSearchParams(), (sp) => {
    sp.set('signalsView', 'browse');
    if (args.entityType) sp.set('entityType', args.entityType);
    if (args.entityId != null) sp.set('entityId', String(args.entityId));
    if (args.signalKind) sp.set('signalKind', args.signalKind);
    if (args.nodeId) sp.set('nodeId', args.nodeId);
  });
}
