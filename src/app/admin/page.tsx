import { StaffManagementTab } from '@/components/admin/StaffManagementTab';
import { StaffAccessMatrixTab } from '@/components/admin/StaffAccessMatrixTab';
import { RolesAdminTab } from '@/components/admin/RolesAdminTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { IntegrationsTab } from '@/components/admin/IntegrationsTab';
import { GoalsAnalyticsTab } from '@/components/admin/GoalsAnalyticsTab';
import { FBAManagementTab } from '@/components/admin/FBAManagementTab';
import { FeaturesManagementTab } from '@/components/admin/FeaturesManagementTab';
import { ManualAssignmentTab } from '@/components/admin/ManualAssignmentTab';
import { AdminLogsTab } from '@/components/admin/AdminLogsTab';
import { AdminJobsTab } from '@/components/admin/AdminJobsTab';
import AiChatTab from '@/components/admin/AiChatTab';
import { ArchitectureTab } from '@/components/admin/ArchitectureTab';
import { PhotoBackupTab } from '@/components/admin/PhotoBackupTab';
import { BillingTab } from '@/components/admin/BillingTab';
import { AdminOverviewTab } from '@/components/admin/AdminOverviewTab';
import { getAdminSection, type AdminSection } from '@/components/admin/admin-sections';
import { requirePermission } from '@/lib/auth/page-guard';

interface AdminPageProps {
  searchParams: Promise<{
    section?: string;
    search?: string;
    manualMode?: string;
    categoryId?: string;
    orderId?: string;
  }>;
}

function renderTab(
  activeTab: AdminSection,
  args: { searchValue: string; manualMode: 'category' | 'orders'; categoryId: string; orderId: string },
) {
  switch (activeTab) {
    case 'overview':     return <AdminOverviewTab />;
    case 'goals':        return <GoalsAnalyticsTab />;
    case 'staff':        return <StaffManagementTab />;
    case 'access':       return <StaffAccessMatrixTab />;
    case 'roles':        return <RolesAdminTab />;
    case 'connections':  return <ConnectionsManagementTab />;
    case 'integrations': return <IntegrationsTab />;
    case 'fba':          return <FBAManagementTab searchTerm={args.searchValue} />;
    case 'features':     return <FeaturesManagementTab />;
    case 'logs':         return <AdminLogsTab initialSearch={args.searchValue} />;
    case 'jobs':         return <AdminJobsTab />;
    case 'ai_chat':      return <AiChatTab />;
    case 'architecture': return <ArchitectureTab />;
    case 'photo_backup': return <PhotoBackupTab />;
    case 'billing':      return <BillingTab />;
    case 'manuals':
      return (
        <ManualAssignmentTab
          manualMode={args.manualMode}
          categoryId={args.categoryId}
          orderId={args.orderId}
          searchValue={args.searchValue}
        />
      );
  }
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const activeTab = getAdminSection(params.section);
  const sidebarSearch = (params.search || '').trim();
  const manualMode = params.manualMode === 'orders' ? 'orders' : 'category';
  const categoryId = (params.categoryId || '').trim();
  const orderId = (params.orderId || '').trim();

  const isManuals = activeTab === 'manuals';
  const containerClass = `flex h-full w-full bg-gray-50 ${isManuals ? 'overflow-hidden' : ''}`;
  const innerClass = `flex-1 min-w-0 ${isManuals ? 'overflow-hidden flex flex-col' : 'overflow-hidden'}`;

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        <div className="h-full min-h-0 w-full">
          {renderTab(activeTab, { searchValue: sidebarSearch, manualMode, categoryId, orderId })}
        </div>
      </div>
    </div>
  );
}
