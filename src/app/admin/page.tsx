import { StaffScheduleTab } from '@/components/admin/StaffScheduleTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { GoalsAnalyticsTab } from '@/components/admin/GoalsAnalyticsTab';
import { QualityDashboardTab } from '@/components/admin/QualityDashboardTab';
import { FBAManagementTab } from '@/components/admin/FBAManagementTab';
import { RepairIssuesManagementTab } from '@/components/admin/RepairIssuesManagementTab';
import { FavoritesManagementTab } from '@/components/admin/FavoritesManagementTab';
import { LocationsManagementTab } from '@/components/admin/LocationsManagementTab';
import { AdminLogsTab } from '@/components/admin/AdminLogsTab';
import { OperationsSection } from '@/components/admin/workflow/OperationsSection';
import { StationNasFoldersTab } from '@/components/admin/StationNasFoldersTab';
import { PoMailboxAdminSection } from '@/components/admin/PoMailboxAdminSection';
import { BoseModelsManagementTab } from '@/components/admin/sourcing/BoseModelsManagementTab';
import { CompatibilityManagementTab } from '@/components/admin/sourcing/CompatibilityManagementTab';
import { SuppliersManagementTab } from '@/components/admin/sourcing/SuppliersManagementTab';
import { SystemSyncActivityTab } from '@/components/admin/SystemSyncActivityTab';
import { AdminOverviewTab } from '@/components/admin/AdminOverviewTab';
import { getAdminSection, type AdminSection } from '@/components/admin/admin-sections';
import { requirePermission } from '@/lib/auth/page-guard';
import { redirect } from 'next/navigation';

interface AdminPageProps {
  searchParams: Promise<{
    section?: string;
    search?: string;
    mode?: string;
    staffId?: string;
    roleId?: string;
  }>;
}

function renderTab(
  activeTab: AdminSection,
  args: { searchValue: string; mode?: string; canManageStock: boolean },
) {
  switch (activeTab) {
    case 'overview':       return <AdminOverviewTab />;
    case 'goals':          return <GoalsAnalyticsTab />;
    case 'quality':        return <QualityDashboardTab />;
    case 'staff_schedule': return <StaffScheduleTab />;
    case 'connections':    return <ConnectionsManagementTab />;
    case 'fba':            return <FBAManagementTab searchTerm={args.searchValue} />;
    case 'bose_models':    return <BoseModelsManagementTab />;
    case 'compatibility':  return <CompatibilityManagementTab />;
    case 'suppliers':      return <SuppliersManagementTab />;
    case 'logs':           return <AdminLogsTab initialSearch={args.searchValue} />;
    case 'architecture':   return <OperationsSection mode={args.mode} canManageStock={args.canManageStock} />;
    case 'system_sync':    return <SystemSyncActivityTab />;
    case 'station_photos': return <StationNasFoldersTab />;
    case 'po_mailbox':     return <PoMailboxAdminSection />;
    case 'repair_issues':  return <RepairIssuesManagementTab />;
    case 'favorites':      return <FavoritesManagementTab />;
    case 'locations':      return <LocationsManagementTab />;
  }
}

function buildSettingsRedirect(
  path: string,
  params: { staffId?: string; roleId?: string },
): string {
  const qs = new URLSearchParams();
  if (params.staffId) qs.set('staffId', params.staffId);
  if (params.roleId) qs.set('roleId', params.roleId);
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const user = await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const rawSection = String(params.section || '').toLowerCase();

  // Reason Codes folded into Operations — preserve old deep links.
  if (rawSection === 'reason_codes') {
    redirect('/admin?section=architecture&mode=reasons');
  }

  // Moved to Settings — preserve query params where applicable.
  if (rawSection === 'integrations') {
    redirect('/settings/integrations');
  }
  if (rawSection === 'access') {
    redirect(buildSettingsRedirect('/settings/access', { staffId: params.staffId }));
  }
  if (rawSection === 'roles') {
    redirect(buildSettingsRedirect('/settings/roles', { roleId: params.roleId }));
  }
  if (rawSection === 'staff') {
    redirect('/admin?section=staff_schedule');
  }

  const activeTab = getAdminSection(params.section);
  const sidebarSearch = (params.search || '').trim();
  const canManageStock = user.permissions.has('sku_stock.manage');

  return (
    <div className="flex h-full w-full bg-gray-50">
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="h-full min-h-0 w-full">
          {renderTab(activeTab, { searchValue: sidebarSearch, mode: params.mode, canManageStock })}
        </div>
      </div>
    </div>
  );
}
