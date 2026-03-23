import { StaffManagementTab } from '@/components/admin/StaffManagementTab';
import { ConnectionsManagementTab } from '@/components/admin/ConnectionsManagementTab';
import { GoalsAnalyticsTab } from '@/components/admin/GoalsAnalyticsTab';
import { FBAManagementTab } from '@/components/admin/FBAManagementTab';
import { ManualAssignmentTab } from '@/components/admin/ManualAssignmentTab';
import { ADMIN_SECTION_OPTIONS, type AdminSection } from '@/components/admin/admin-sections';

interface AdminPageProps {
  searchParams: Promise<{
    section?: string;
    search?: string;
    manualMode?: string;
    categoryId?: string;
    orderId?: string;
  }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const requestedSection = (params.section as AdminSection) || 'goals';
  const activeTab = ADMIN_SECTION_OPTIONS.some((item) => item.value === requestedSection)
    ? requestedSection
    : 'goals';
  const sidebarSearch = (params.search || '').trim();
  const manualMode = params.manualMode === 'orders' ? 'orders' : 'category';
  const categoryId = (params.categoryId || '').trim();
  const orderId = (params.orderId || '').trim();

  const isManuals = activeTab === 'manuals';

  return (
    <div className={`flex h-full w-full bg-gray-50 ${isManuals ? 'overflow-hidden' : ''}`}>
      <div className={`flex-1 min-w-0 ${isManuals ? 'overflow-hidden flex flex-col' : 'overflow-hidden'}`}>
        {isManuals ? (
          <ManualAssignmentTab
            manualMode={manualMode}
            categoryId={categoryId}
            orderId={orderId}
            searchValue={sidebarSearch}
          />
        ) : activeTab === 'connections' || activeTab === 'goals' || activeTab === 'staff' || activeTab === 'fba' ? (
          <div className="h-full min-h-0 w-full">
            {activeTab === 'connections' ? (
              <ConnectionsManagementTab />
            ) : activeTab === 'goals' ? (
              <GoalsAnalyticsTab />
            ) : activeTab === 'staff' ? (
              <StaffManagementTab />
            ) : (
              <FBAManagementTab searchTerm={sidebarSearch} />
            )}
          </div>
        ) : (
          <div className="h-full min-h-0 p-4">
            <GoalsAnalyticsTab />
          </div>
        )}
      </div>
    </div>
  );
}
