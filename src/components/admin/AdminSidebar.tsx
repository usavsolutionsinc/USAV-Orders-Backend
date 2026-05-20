'use client';

import { useMemo } from 'react';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { ChevronLeft } from '@/components/Icons';
import { SidebarSectionList, type SidebarSection } from '@/components/sidebar/SidebarSectionList';
import { useAuth } from '@/contexts/AuthContext';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from './admin-sections';

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

const ICON_CLS = 'h-4 w-4 shrink-0';

function panelFor(section: AdminSection): JSX.Element | null {
  switch (section) {
    case 'manuals':      return <ManualAssignmentSidebarPanel />;
    case 'goals':        return <GoalsSidebarPanel />;
    case 'staff':        return <StaffAdminSidebarPanel />;
    case 'access':       return <AccessSidebarPanel />;
    case 'roles':        return <RolesSidebarPanel />;
    case 'fba':          return <FbaCatalogSidebarPanel />;
    case 'features':     return <FeaturesSidebarPanel />;
    case 'connections':  return <ConnectionsSidebarPanel />;
    case 'architecture': return <ArchitectureSidebarPanel />;
    case 'jobs':         return <JobsSidebarPanel />;
    case 'logs':         return <LogsSidebarPanel />;
    default:             return null;
  }
}

export function AdminSidebar({ activeSection, onSectionChange }: AdminSidebarProps) {
  const { has, isLoaded } = useAuth();

  const visibleSections = useMemo<Array<SidebarSection<AdminSection>>>(() => {
    return ADMIN_SECTION_OPTIONS
      .filter((s) => {
        if (!s.requires) return true;
        if (!isLoaded) return false;
        return has(s.requires);
      })
      .map((s) => {
        const Icon = s.icon;
        return {
          id: s.value,
          label: s.label,
          description: s.description,
          group: s.group,
          requires: s.requires,
          icon: <Icon className={ICON_CLS} />,
        };
      });
  }, [has, isLoaded]);

  const isOverview = activeSection === 'overview';
  const sectionPanel = isOverview ? null : panelFor(activeSection);
  const sectionLabel = ADMIN_SECTION_OPTIONS.find((s) => s.value === activeSection)?.label ?? '';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {isOverview ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <SidebarSectionList
            sections={visibleSections}
            active={activeSection}
            onSelect={(next) => onSectionChange(next)}
            ariaLabel="Admin sections"
          />
        </div>
      ) : (
        <>
          <div className={`${sidebarHeaderBandClass} px-2 py-2`}>
            <button
              type="button"
              onClick={() => onSectionChange('overview')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              aria-label="Back to admin overview"
            >
              <ChevronLeft className="h-4 w-4 text-slate-500" />
              <span>Admin</span>
              {sectionLabel && (
                <>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-900">{sectionLabel}</span>
                </>
              )}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{sectionPanel}</div>
        </>
      )}
    </div>
  );
}
