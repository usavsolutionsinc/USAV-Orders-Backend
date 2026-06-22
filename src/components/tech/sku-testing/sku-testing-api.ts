import type { Bundle, ManualRow, UnitResult } from './sku-testing-types';

/**
 * Pure network layer for the SKU testing panel. Plain fetch (no React Query) so
 * it never refetches on window focus and clobbers an in-progress edit. Mutations
 * throw with the server's error message (or a status fallback); reads return
 * normalized data.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Load the line's SKU catalog crosswalk + checklist + manuals. Never throws —
 *  falls back to an empty, no-catalog bundle so the panel still renders. */
export async function fetchTestingBundle(
  receivingLineId: number,
  fallbackSku: string,
  fallbackTitle: string,
): Promise<Bundle> {
  const res = await fetch(`/api/receiving-lines/${receivingLineId}/testing-bundle`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) {
    return {
      skuCatalogId: data.skuCatalogId ?? null,
      sku: data.sku ?? fallbackSku,
      title: data.title ?? fallbackTitle,
      checklist: data.checklist ?? [],
      manuals: data.manuals ?? [],
    };
  }
  return { skuCatalogId: null, sku: fallbackSku, title: fallbackTitle, checklist: [], manuals: [] };
}

/** Load per-unit recorded results, keyed by step id. Returns null on failure
 *  (caller keeps the existing map). */
export async function fetchUnitChecklist(serialUnitId: number): Promise<Record<number, UnitResult> | null> {
  const res = await fetch(`/api/serial-units/${serialUnitId}/checklist`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) return null;
  const map: Record<number, UnitResult> = {};
  for (const s of data.steps as Array<UnitResult & { step_id: number }>) {
    map[s.step_id] = {
      step_id: s.step_id,
      passed: s.passed,
      verified_by_name: s.verified_by_name,
      value_num: s.value_num ?? null,
      value_text: s.value_text ?? null,
    };
  }
  return map;
}

async function postOk(url: string, init: RequestInit, failMsg: string): Promise<void> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `${failMsg} (${res.status})`);
}

/** Pass (or clear) every step for this unit in one call. */
export function bulkSetChecklist(serialUnitId: number, action: 'pass' | 'clear'): Promise<void> {
  return postOk(
    `/api/serial-units/${serialUnitId}/checklist/bulk`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action }) },
    'Failed',
  );
}

export function addQcCheck(receivingLineId: number, stepLabel: string, sortOrder: number): Promise<void> {
  return postOk(
    `/api/receiving-lines/${receivingLineId}/qc-checks`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ stepLabel, sortOrder }) },
    'Add failed',
  );
}

export function updateQcCheck(receivingLineId: number, checkId: number, stepLabel: string): Promise<void> {
  return postOk(
    `/api/receiving-lines/${receivingLineId}/qc-checks`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ checkId, stepLabel }) },
    'Save failed',
  );
}

export function deleteQcCheck(receivingLineId: number, checkId: number): Promise<void> {
  return postOk(
    `/api/receiving-lines/${receivingLineId}/qc-checks`,
    { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ checkId }) },
    'Delete failed',
  );
}

/** Record a step result for a unit — pass/fail toggle or a structured value. */
export function recordChecklistStep(
  serialUnitId: number,
  body: { stepId: number; passed?: boolean; valueNum?: number; valueText?: string | null },
): Promise<void> {
  return postOk(
    `/api/serial-units/${serialUnitId}/checklist`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
    'Save failed',
  );
}

export function ensureCatalog(receivingLineId: number): Promise<void> {
  return postOk(`/api/receiving-lines/${receivingLineId}/ensure-catalog`, { method: 'POST' }, 'Failed');
}

export function pairManual(receivingLineId: number, manualId: number): Promise<void> {
  return postOk(
    `/api/receiving-lines/${receivingLineId}/manuals`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ manualId }) },
    'Pair failed',
  );
}

export function unpairManual(receivingLineId: number, manualId: number): Promise<void> {
  return postOk(
    `/api/receiving-lines/${receivingLineId}/manuals`,
    { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ manualId }) },
    'Unpair failed',
  );
}

/** Search the manuals library. Returns [] on any failure. */
export async function searchManuals(query: string): Promise<ManualRow[]> {
  const res = await fetch(`/api/product-manuals?search=${encodeURIComponent(query)}&limit=10`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : data?.rows ?? data?.manuals ?? data?.results ?? [];
}
