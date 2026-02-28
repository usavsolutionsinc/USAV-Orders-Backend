'use client';

import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';

export type AdminSection = 'goals' | 'staff' | 'connections' | 'fba';

export const ADMIN_SECTION_OPTIONS: Array<ViewDropdownOption<AdminSection> & { description: string }> = [
  { value: 'goals', label: 'Goals', description: 'Goal targets and performance tracking' },
  { value: 'staff', label: 'Staff', description: 'Active personnel and access setup' },
  { value: 'connections', label: 'Connections', description: 'Source connections and credentials' },
  { value: 'fba', label: 'FBA', description: 'FBA SKU and fulfillment management' },
];

interface AdminSidebarProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

export function AdminSidebar({
  activeSection,
  onSectionChange,
  searchValue,
  onSearchChange,
}: AdminSidebarProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <ViewDropdown
        options={ADMIN_SECTION_OPTIONS}
        value={activeSection}
        onChange={onSectionChange}
      />
      <div className="flex h-[calc(100%-56px)] flex-col overflow-hidden px-6 pb-6 pt-4">
        <div>
          <SearchBar
            value={searchValue}
            onChange={onSearchChange}
            onClear={() => onSearchChange('')}
            placeholder="Search admin sections..."
            className="w-full"
            variant="blue"
          />
        </div>
      </div>
    </div>
  );
}
