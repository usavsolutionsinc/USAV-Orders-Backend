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

let _promise: Promise<any[]> | null = null;

export function getReceivingLogs(limit = 500): Promise<any[]> {
  if (!_promise) {
    _promise = fetch(`/api/receiving-logs?limit=${limit}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        _promise = null;
        return Array.isArray(data) ? data : [];
      })
      .catch(() => {
        _promise = null;
        return [];
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
