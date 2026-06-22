import type { MissingResponse, MissingStatus, PreviewResponse, ReconcileResponse } from './po-mailbox-types';

/** Pure network layer for the PO mailbox reconciler. Throws `${status}: <body>` on failure. */

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function fetchReconcile(query: string, limit: number): Promise<ReconcileResponse> {
  const url = new URL('/api/admin/po-gmail/reconcile', window.location.origin);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  await assertOk(res);
  return (await res.json()) as ReconcileResponse;
}

export async function fetchRawPreview(query: string, limit: number): Promise<PreviewResponse> {
  const url = new URL('/api/admin/po-gmail/preview-unread', window.location.origin);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  await assertOk(res);
  return (await res.json()) as PreviewResponse;
}

export async function fetchMissingOrders(status: MissingStatus): Promise<MissingResponse> {
  const url = new URL('/api/admin/po-gmail/missing-orders', window.location.origin);
  url.searchParams.set('status', status);
  url.searchParams.set('limit', '100');
  const res = await fetch(url.toString(), { cache: 'no-store' });
  await assertOk(res);
  return (await res.json()) as MissingResponse;
}

export async function patchMissingStatus(id: string, status: MissingStatus): Promise<void> {
  const res = await fetch('/api/admin/po-gmail/missing-orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
  await assertOk(res);
}
