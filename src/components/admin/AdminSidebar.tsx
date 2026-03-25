'use client';

import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from './admin-sections';
import { ManualAssignmentSidebarPanel } from './ManualAssignmentSidebarPanel';
import { ConnectionsSidebarPanel } from '@/components/sidebar/ConnectionsSidebarPanel';
import { GoalsSidebarPanel } from '@/components/sidebar/GoalsSidebarPanel';
import { StaffAdminSidebarPanel } from '@/components/sidebar/StaffAdminSidebarPanel';
import { AdminFbaSidebarPanel } from '@/components/fba/sidebar';

interface AdminSidebarProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
}

export function AdminSidebar({
  activeSection,
  onSectionChange,
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
      ) : activeSection === 'staff' ? (
        <div className="flex-1 overflow-hidden">
          <StaffAdminSidebarPanel />
        </div>
      ) : activeSection === 'fba' ? (
        <div className="flex-1 overflow-hidden">
          <AdminFbaSidebarPanel />
        </div>
      ) : activeSection === 'connections' ? (
        <div className="flex-1 overflow-hidden">
          <ConnectionsSidebarPanel />
        </div>
      ) : (
        <div className="flex-1 bg-white" />
      )}
    </div>
  );
}
