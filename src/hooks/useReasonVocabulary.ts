'use client';

import { useEffect, useState } from 'react';

/**
 * Generic client read for a Class-D reason vocabulary: fetches tenant
 * `reason_codes` rows for a `flow_context` and caches them per session. Each
 * vocabulary's component/hook merges these {code,label} rows with its built-in
 * registry for display metadata (tone/hint) and falls back to the built-ins when
 * the DB is unseeded or the fetch fails — see
 * docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md D1.
 *
 * Returns null until the first load resolves (so callers render their built-in
 * fallback immediately, no empty flash).
 */
interface ReasonRow {
  code: string;
  label: string;
}

const caches = new Map<string, Promise<ReasonRow[]>>();

async function loadVocabulary(flowContext: string): Promise<ReasonRow[]> {
  const res = await fetch(`/api/reason-codes?flowContext=${encodeURIComponent(flowContext)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`reason-codes ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.reason_codes) ? data.reason_codes : [];
  return rows.map((r: { code: unknown; label: unknown }) => ({ code: String(r.code), label: String(r.label) }));
}

export function useReasonVocabulary(flowContext: string): ReasonRow[] | null {
  const [rows, setRows] = useState<ReasonRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    let p = caches.get(flowContext);
    if (!p) {
      p = loadVocabulary(flowContext).catch(() => []);
      caches.set(flowContext, p);
    }
    p.then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [flowContext]);

  return rows;
}
