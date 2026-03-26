import { runDueShipments } from '@/lib/shipping/scheduler';

export interface ShippingSyncDuePayload {
  limit?: unknown;
  concurrency?: unknown;
  carrier?: unknown;
  carriers?: unknown;
}

export interface ShippingSyncDueJobResult {
  ok: boolean;
  synced: number;
  terminal: number;
  errors: number;
  durationMs: number;
}

export function normalizeShippingSyncDuePayload(
  payload: ShippingSyncDuePayload = {}
): { limit: number; concurrency: number; carriers?: Array<'UPS' | 'USPS' | 'FEDEX'> } {
  let limit = 50;
  let concurrency = 5;
  let carriers: Array<'UPS' | 'USPS' | 'FEDEX'> | undefined;

  if (payload.limit) limit = Math.min(Number(payload.limit), 200);
  if (payload.concurrency) concurrency = Math.min(Number(payload.concurrency), 10);

  const carrierInput = payload.carrier ?? payload.carriers;
  if (carrierInput) {
    const values = Array.isArray(carrierInput) ? carrierInput : [carrierInput];
    const normalized = values
      .map((value) => String(value).toUpperCase())
      .filter((value): value is 'UPS' | 'USPS' | 'FEDEX' => ['UPS', 'USPS', 'FEDEX'].includes(value));
    if (normalized.length > 0) carriers = normalized;
  }

  return { limit, concurrency, carriers };
}

export async function runShippingSyncDueJob(
  payload: ShippingSyncDuePayload = {}
): Promise<ShippingSyncDueJobResult> {
  const { limit, concurrency, carriers } = normalizeShippingSyncDuePayload(payload);
  const result = await runDueShipments({ limit, concurrency, carriers });
  return { ok: true, ...result };
}
