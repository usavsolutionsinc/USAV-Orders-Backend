import { getCurrentPSTDateKey } from '@/utils/date';

export interface StaffMember {
  id: number;
  name: string;
  role: string;
}

// Module-level singleton: one fetch per page load, shared across all consumers.
let _promise: Promise<StaffMember[]> | null = null;
let _data: StaffMember[] | null = null;
let _presentPromise: Promise<StaffMember[]> | null = null;
let _presentData: StaffMember[] | null = null;
let _presentDateKey: string | null = null;

function normalizeStaff(raw: any[]): StaffMember[] {
  return Array.isArray(raw)
    ? raw.map((m) => ({
        id: Number(m.id),
        name: String(m.name || ''),
        role: String(m.role || ''),
      }))
    : [];
}

export function getActiveStaff(): Promise<StaffMember[]> {
  if (_data) return Promise.resolve(_data);
  if (!_promise) {
    _promise = fetch('/api/staff?active=true')
      .then((res) => (res.ok ? res.json() : []))
      .then((raw: any[]) => {
        const result = normalizeStaff(raw);
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

export function getPresentStaffForToday(): Promise<StaffMember[]> {
  const todayKey = getCurrentPSTDateKey();
  if (_presentData && _presentDateKey === todayKey) return Promise.resolve(_presentData);

  if (!_presentPromise || _presentDateKey !== todayKey) {
    _presentDateKey = todayKey;
    _presentPromise = fetch('/api/staff?active=true&presentToday=true')
      .then((res) => (res.ok ? res.json() : []))
      .then((raw: any[]) => {
        const result = normalizeStaff(raw);
        _presentData = result;
        return result;
      })
      .catch(() => {
        // Reset so the next mount can retry
        _presentPromise = null;
        _presentData = null;
        return [];
      });
  }

  return _presentPromise;
}

/** Call this when staff data changes (e.g. after a PUT/POST to /api/staff). */
export function invalidateStaffCache(): void {
  _data = null;
  _promise = null;
  _presentData = null;
  _presentPromise = null;
  _presentDateKey = null;
}
