'use client';

import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from './admin-sections';
import { ManualAssignmentSidebarPanel } from './ManualAssignmentSidebarPanel';
import { ConnectionsSidebarPanel } from '@/components/sidebar/ConnectionsSidebarPanel';
import { GoalsSidebarPanel } from '@/components/sidebar/GoalsSidebarPanel';
import { StaffAdminSidebarPanel } from '@/components/sidebar/StaffAdminSidebarPanel';
import { AdminFbaSidebarPanel } from '@/components/fba/sidebar';
import { FeaturesSidebarPanel } from '@/components/sidebar/FeaturesSidebarPanel';

interface AdminSidebarProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
}

export function AdminSidebar({
  activeSection,
  onSectionChange,
}: AdminSidebarProps) {
  const activePanel =
    activeSection === 'manuals' ? (
      <ManualAssignmentSidebarPanel />
    ) : activeSection === 'goals' ? (
      <GoalsSidebarPanel />
    ) : activeSection === 'staff' ? (
      <StaffAdminSidebarPanel />
    ) : activeSection === 'fba' ? (
      <AdminFbaSidebarPanel />
    ) : activeSection === 'features' ? (
      <FeaturesSidebarPanel />
    ) : activeSection === 'connections' ? (
      <ConnectionsSidebarPanel />
    ) : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <ViewDropdown
        options={ADMIN_SECTION_OPTIONS}
        value={activeSection}
        onChange={onSectionChange}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{activePanel}</div>
    </div>
  );
}
