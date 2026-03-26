export type AdminSection = 'goals' | 'staff' | 'connections' | 'fba' | 'manuals';

export interface AdminSectionOption {
  value: AdminSection;
  label: string;
  description: string;
}

export const ADMIN_SECTION_OPTIONS: AdminSectionOption[] = [
  { value: 'goals', label: 'Goals', description: 'Daily output targets and progress' },
  { value: 'staff', label: 'Staff', description: 'Team roles, status, and weekly schedule' },
  { value: 'connections', label: 'Connections', description: 'Marketplace, Zoho, and shipping sync tools' },
  { value: 'fba', label: 'FBA', description: 'FNSKU catalog rows and CSV imports' },
  { value: 'manuals', label: 'Manuals', description: 'Link product manuals to item numbers' },
];
