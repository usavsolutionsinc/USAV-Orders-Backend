export type AdminSection = 'goals' | 'staff' | 'connections' | 'fba';

export interface AdminSectionOption {
  value: AdminSection;
  label: string;
  description: string;
}

export const ADMIN_SECTION_OPTIONS: AdminSectionOption[] = [
  { value: 'goals', label: 'Goals', description: 'Goal targets and performance tracking' },
  { value: 'staff', label: 'Staff', description: 'Active personnel and access setup' },
  { value: 'connections', label: 'Connections', description: 'Source connections and credentials' },
  { value: 'fba', label: 'FBA', description: 'FBA SKU and fulfillment management' },
];
