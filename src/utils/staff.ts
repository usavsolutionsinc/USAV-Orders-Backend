export const STAFF_NAMES: Record<number, string> = {
  1: 'Michael',
  2: 'Thuc',
  3: 'Sang',
  4: 'Tuan',
  5: 'Thuy',
  6: 'Cuong',
  7: 'Kai',
  8: 'Lien',
};

/** Packer staff IDs in display order. */
export const PACKER_IDS: readonly number[] = [4, 5];

/** Technician names in display/sort order. */
export const TECH_NAME_ORDER: readonly string[] = ['michael', 'thuc', 'sang', 'cuong'];

/** Packer names in display/sort order. */
export const PACKER_NAME_ORDER: readonly string[] = ['tuan', 'thuy'];

/** Default bulk-assign staff: Cuong (tech) + Thuy (packer). */
export const DEFAULT_TECH_ID = 6;   // Cuong
export const DEFAULT_PACKER_ID = 5; // Thuy

/** Legacy employee ID mapping (station number → employee_id in DB). */
export const TECH_EMPLOYEE_IDS: Record<string, string> = {
  '1': 'TECH001',
  '2': 'TECH002',
  '3': 'TECH003',
  '4': 'TECH004',
};

/** Reverse lookup: staff name (lowercase) → staff ID. */
export const STAFF_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(STAFF_NAMES).map(([id, name]) => [name.toLowerCase(), Number(id)])
);

export function getStaffName(staffId: number | null | undefined): string {
  if (!staffId) return 'Not specified';
  return STAFF_NAMES[staffId] || `Staff #${staffId}`;
}

export function getStaffIdByName(name: string): number | null {
  return STAFF_ID_BY_NAME[name.trim().toLowerCase()] ?? null;
}
