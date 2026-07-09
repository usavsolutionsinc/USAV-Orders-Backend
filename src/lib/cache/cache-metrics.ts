/**
 * Per-namespace cache counters (Phase 0.6).
 *
 * A lightweight in-process sampler: {hits, misses, errors, rebuildMs, rebuilds}
 * per namespace. Under Fluid Compute these are per-instance, so treat them as a
 * sampled signal (good enough to see hit-rate and tune TTLs), not a global total.
 * A future revision can flush these to Redis HINCRBY for fleet-wide totals; the
 * recording API stays the same.
 *
 * Surfaced via getCacheMetricsSnapshot() at /api/admin/cache-stats (and /api/ready).
 */
export interface NamespaceCounters {
  hits: number;
  misses: number;
  errors: number;
  rebuilds: number;
  rebuildMs: number;
}

const counters = new Map<string, NamespaceCounters>();

function bucket(ns: string): NamespaceCounters {
  let c = counters.get(ns);
  if (!c) {
    c = { hits: 0, misses: 0, errors: 0, rebuilds: 0, rebuildMs: 0 };
    counters.set(ns, c);
  }
  return c;
}

export function recordCacheHit(ns: string): void {
  bucket(ns).hits++;
}
export function recordCacheMiss(ns: string): void {
  bucket(ns).misses++;
}
export function recordCacheError(ns: string): void {
  bucket(ns).errors++;
}
export function recordCacheRebuild(ns: string, ms: number): void {
  const c = bucket(ns);
  c.rebuilds++;
  c.rebuildMs += Math.max(0, ms);
}

export interface NamespaceMetric extends NamespaceCounters {
  namespace: string;
  hitRate: number | null;
  avgRebuildMs: number | null;
}

export function getCacheMetricsSnapshot(): NamespaceMetric[] {
  const out: NamespaceMetric[] = [];
  for (const [namespace, c] of counters) {
    const total = c.hits + c.misses;
    out.push({
      namespace,
      ...c,
      hitRate: total > 0 ? c.hits / total : null,
      avgRebuildMs: c.rebuilds > 0 ? c.rebuildMs / c.rebuilds : null,
    });
  }
  return out.sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/** Test-only: clear all counters. */
export function __resetCacheMetricsForTest(): void {
  counters.clear();
}
