import { StaffManagementTab } from '@/components/admin/StaffManagementTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { GoalsAnalyticsTab } from '@/components/admin/GoalsAnalyticsTab';
import { FBAManagementTab } from '@/components/admin/FBAManagementTab';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/AdminSidebar';

interface AdminPageProps {
  searchParams: Promise<{
    section?: string;
    search?: string;
  }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const requestedSection = (params.section as AdminSection) || 'goals';
  const activeTab = ADMIN_SECTION_OPTIONS.some((item) => item.value === requestedSection) ? requestedSection : 'goals';
  const sidebarSearch = params.search || '';

  return (
    <div className="flex h-full w-full bg-gray-50">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="min-h-full p-4">
          {activeTab === 'staff' ? (
            <StaffManagementTab />
          ) : activeTab === 'connections' ? (
            <ConnectionsManagementTab />
          ) : activeTab === 'fba' ? (
            <FBAManagementTab searchTerm={sidebarSearch} />
          ) : (
            <GoalsAnalyticsTab />
          )}
        </div>
      </div>
    </div>
  );
}
