'use client';

import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from './admin-sections';
import { ManualAssignmentSidebarPanel } from './ManualAssignmentSidebarPanel';
import { ConnectionsSidebarPanel } from '@/components/sidebar/ConnectionsSidebarPanel';
import { GoalsSidebarPanel } from '@/components/sidebar/GoalsSidebarPanel';

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

      {activeSection === 'manuals' ? (
        <div className="flex-1 overflow-hidden">
          <ManualAssignmentSidebarPanel />
        </div>
      ) : activeSection === 'goals' ? (
        <div className="flex-1 overflow-hidden">
          <GoalsSidebarPanel />
        </div>
      ) : activeSection === 'connections' ? (
        <div className="flex-1 overflow-hidden">
          <ConnectionsSidebarPanel />
        </div>
      ) : (
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
      )}
    </div>
  );
}
