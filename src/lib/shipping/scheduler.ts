import { getDueShipments } from './repository';
import { syncShipment } from './sync-shipment';

export interface SchedulerResult {
  synced: number;
  terminal: number;
  errors: number;
  durationMs: number;
}

/**
 * Re-poll an explicit set of shipments now (operator-triggered refresh),
 * bypassing `next_check_at`. Carrier-grouped + chunked exactly like
 * {@link runDueShipments} so per-carrier rate limits are respected. Used by the
 * Incoming receiving "Refresh tracking" button to flip just-delivered packages
 * to DELIVERED so the "Delivered · not scanned" count reflects reality.
 */
export async function syncShipmentsByIds(
  rows: Array<{ id: number; carrier: string }>,
  options?: { concurrency?: number },
): Promise<SchedulerResult> {
  const concurrency = options?.concurrency ?? 5;
  const start = Date.now();
  if (rows.length === 0) {
    return { synced: 0, terminal: 0, errors: 0, durationMs: Date.now() - start };
  }

  const byCarrier: Record<string, typeof rows> = {};
  for (const row of rows) {
    (byCarrier[row.carrier] ??= []).push(row);
  }

  let synced = 0;
  let terminal = 0;
  let errors = 0;

  for (const carrierRows of Object.values(byCarrier)) {
    for (let i = 0; i < carrierRows.length; i += concurrency) {
      const chunk = carrierRows.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map((row) => syncShipment({ shipmentId: row.id })),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          if (r.value.status === 'DELIVERED' || r.value.status === 'RETURNED') terminal++;
          else synced++;
        } else {
          errors++;
        }
      }
    }
  }

  return { synced, terminal, errors, durationMs: Date.now() - start };
}

export async function runDueShipments(options?: {
  limit?: number;
  concurrency?: number;
  carriers?: Array<'UPS' | 'USPS' | 'FEDEX'>;
}): Promise<SchedulerResult> {
  const limit = options?.limit ?? 50;
  const concurrency = options?.concurrency ?? 5;
  const start = Date.now();

  const due = await getDueShipments(limit, options?.carriers);

  if (due.length === 0) {
    return { synced: 0, terminal: 0, errors: 0, durationMs: Date.now() - start };
  }

  // Group by carrier to respect per-carrier rate limits
  const byCarrier: Record<string, typeof due> = {};
  for (const row of due) {
    const c = row.carrier;
    if (!byCarrier[c]) byCarrier[c] = [];
    byCarrier[c].push(row);
  }

  let synced = 0;
  let terminal = 0;
  let errors = 0;

  for (const rows of Object.values(byCarrier)) {
    // Process this carrier's rows in chunks of `concurrency`
    for (let i = 0; i < rows.length; i += concurrency) {
      const chunk = rows.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map((row) => syncShipment({ shipmentId: row.id }))
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.ok) {
            if (r.value.status === 'DELIVERED' || r.value.status === 'RETURNED') {
              terminal++;
            } else {
              synced++;
            }
          } else {
            errors++;
          }
        } else {
          errors++;
        }
      }
    }
  }

  return { synced, terminal, errors, durationMs: Date.now() - start };
}
