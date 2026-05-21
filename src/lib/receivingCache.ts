/**
 * Module-level in-flight deduplicator for receiving logs.
 *
 * ReceivingDashboard and ReceivingSidebar both mount on the /receiving page
 * and independently fetch the same 500-row endpoint. This cache ensures only
 * ONE network request is in flight at any given moment — both components share
 * the same promise and get the same data when it resolves.
 *
 * The promise is cleared after resolution so that a manual refresh (e.g.
 * triggered by a usav-refresh-data event) always fetches fresh data. Because
 * both components handle the refresh event synchronously in the same event-loop
 * turn, the first call creates a new promise and the second call shares it.
 */

export type ReceivingLogsResult =
  | { ok: true; data: unknown[] }
  | { ok: false; error: string; status?: number };

let _promise: Promise<ReceivingLogsResult> | null = null;

export function getReceivingLogs(limit = 500): Promise<ReceivingLogsResult> {
  if (!_promise) {
    _promise = fetch(`/api/receiving-logs?limit=${limit}`)
      .then(async (res): Promise<ReceivingLogsResult> => {
        _promise = null;
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}`, status: res.status };
        }
        const data = await res.json().catch(() => null);
        if (!Array.isArray(data)) {
          return { ok: false, error: 'response was not an array' };
        }
        return { ok: true, data };
      })
      .catch((err): ReceivingLogsResult => {
        _promise = null;
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      });
  }
  return _promise;
}

/**
 * Force the next call to getReceivingLogs() to make a fresh network request.
 * Call this before re-fetching on refresh events.
 */
export function invalidateReceivingCache(): void {
  _promise = null;
}
