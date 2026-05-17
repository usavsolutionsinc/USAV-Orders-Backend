/**
 * Workstation settings — identifies the physical station an operator is at.
 * Used to pre-fill receiving/packing forms and scope scans / filters.
 */

const KEY = 'usav.workstation';

export type WorkstationRole = '' | 'packer' | 'tech' | 'receiver' | 'admin';

export interface WorkstationSettings {
  stationName: string;
  defaultWarehouse: string;
  defaultRole: WorkstationRole;
}

export const DEFAULT_WORKSTATION: WorkstationSettings = {
  stationName: '',
  defaultWarehouse: '',
  defaultRole: '',
};

export function getWorkstation(): WorkstationSettings {
  if (typeof window === 'undefined') return DEFAULT_WORKSTATION;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_WORKSTATION;
    const parsed = JSON.parse(raw) as Partial<WorkstationSettings>;
    return {
      stationName: String(parsed.stationName ?? ''),
      defaultWarehouse: String(parsed.defaultWarehouse ?? ''),
      defaultRole: (parsed.defaultRole ?? '') as WorkstationRole,
    };
  } catch {
    return DEFAULT_WORKSTATION;
  }
}

export function setWorkstation(patch: Partial<WorkstationSettings>): WorkstationSettings {
  const next = { ...getWorkstation(), ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}
