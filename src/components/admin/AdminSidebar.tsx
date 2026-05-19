'use client';

import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
  BarChart3,
  Box,
  Calendar,
  Camera,
  Database,
  FileText,
  Layout,
  Link2,
  Lock,
  Package,
  ShieldCheck,
  User,
  Zap,
} from '@/components/Icons';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from './admin-sections';

const ADMIN_SECTION_ICONS: Record<AdminSection, (props: { className?: string }) => JSX.Element> = {
  goals:        BarChart3,
  staff:        User,
  access:       Lock,
  roles:        ShieldCheck,
  connections:  Link2,
  fba:          Package,
  manuals:      FileText,
  features:     Box,
  logs:         FileText,
  jobs:         Calendar,
  ai_chat:      Zap,
  architecture: Database,
  photo_backup: Camera,
};

const ADMIN_SECTION_ITEMS: HorizontalSliderItem[] = ADMIN_SECTION_OPTIONS.map((o) => ({
  id: o.value,
  label: o.label,
  icon: ADMIN_SECTION_ICONS[o.value] ?? Layout,
}));
import { ManualAssignmentSidebarPanel } from './ManualAssignmentSidebarPanel';
import { AccessSidebarPanel } from './AccessSidebarPanel';
import { RolesSidebarPanel } from './RolesSidebarPanel';
import { ConnectionsSidebarPanel } from '@/components/sidebar/ConnectionsSidebarPanel';
import { GoalsSidebarPanel } from '@/components/sidebar/GoalsSidebarPanel';
import { StaffAdminSidebarPanel } from '@/components/sidebar/StaffAdminSidebarPanel';
import { FbaCatalogSidebarPanel } from './FbaCatalogSidebarPanel';
import { FeaturesSidebarPanel } from '@/components/sidebar/FeaturesSidebarPanel';
import { ArchitectureSidebarPanel } from './ArchitectureSidebarPanel';
import { JobsSidebarPanel } from './JobsSidebarPanel';
import { LogsSidebarPanel } from './LogsSidebarPanel';

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
    ) : activeSection === 'access' ? (
      <AccessSidebarPanel />
    ) : activeSection === 'roles' ? (
      <RolesSidebarPanel />
    ) : activeSection === 'fba' ? (
      <FbaCatalogSidebarPanel />
    ) : activeSection === 'features' ? (
      <FeaturesSidebarPanel />
    ) : activeSection === 'connections' ? (
      <ConnectionsSidebarPanel />
    ) : activeSection === 'architecture' ? (
      <ArchitectureSidebarPanel />
    ) : activeSection === 'jobs' ? (
      <JobsSidebarPanel />
    ) : activeSection === 'logs' ? (
      <LogsSidebarPanel />
    ) : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div className={`${sidebarHeaderBandClass} px-3`}>
        <HorizontalButtonSlider
          items={ADMIN_SECTION_ITEMS}
          value={activeSection}
          onChange={(next) => onSectionChange(next as AdminSection)}
          variant="nav"
          aria-label="Admin section"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{activePanel}</div>
    </div>
  );
}
