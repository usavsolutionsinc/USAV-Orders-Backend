export type StaffRole = 'technician' | 'packer';

export type StaffUpdatePayload = {
  id: number;
  name?: string;
  role?: StaffRole;
  employee_id?: string;
  active?: boolean;
  color_hex?: string;
  default_home_path?: string | null;
};

export function toNullableDateInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Curated list of paths the admin can pick as a per-staff default landing
 * page. Keeping this in code (instead of free-text) prevents typos that
 * would send staff to a 404 on every sign-in. Add a new entry when a new
 * dashboard ships.
 */
export const STAFF_HOME_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/dashboard',   label: 'Orders / Shipping' },
  { value: '/operations',  label: 'Operations' },
  { value: '/receiving',   label: 'Receiving' },
  { value: '/tech',        label: 'Testing' },
  { value: '/packer',      label: 'Packing' },
  { value: '/inventory',   label: 'Inventory' },
  { value: '/warehouse',   label: 'Warehouse' },
  { value: '/products',    label: 'Products' },
  { value: '/walk-in',     label: 'Walk-in' },
  { value: '/fba',         label: 'Amazon FBA' },
  { value: '/inventory?section=replenish', label: 'Replenish' },
  { value: '/admin',       label: 'Admin' },
];
