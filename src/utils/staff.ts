export const STAFF_NAMES: { [key: number]: string } = {
  1: 'Michael',
  2: 'Thuc',
  3: 'Sang',
  4: 'Tuan',
  5: 'Thuy',
  6: 'Cuong',
};

export function getStaffName(staffId: number | null | undefined): string {
  if (!staffId) return 'Not specified';
  return STAFF_NAMES[staffId] || `Staff #${staffId}`;
}
