export interface StaffMember {
  id: number;
  name: string;
  role: string;
}

// Module-level singleton: one fetch per page load, shared across all consumers.
let _promise: Promise<StaffMember[]> | null = null;
let _data: StaffMember[] | null = null;

export function getActiveStaff(): Promise<StaffMember[]> {
  if (_data) return Promise.resolve(_data);
  if (!_promise) {
    _promise = fetch('/api/staff?active=true')
      .then((res) => (res.ok ? res.json() : []))
      .then((raw: any[]) => {
        const result: StaffMember[] = Array.isArray(raw)
          ? raw.map((m) => ({
              id: Number(m.id),
              name: String(m.name || ''),
              role: String(m.role || ''),
            }))
          : [];
        _data = result;
        return result;
      })
      .catch(() => {
        // Reset so the next mount can retry
        _promise = null;
        return [];
      });
  }
  return _promise;
}

/** Call this when staff data changes (e.g. after a PUT/POST to /api/staff). */
export function invalidateStaffCache(): void {
  _data = null;
  _promise = null;
}
