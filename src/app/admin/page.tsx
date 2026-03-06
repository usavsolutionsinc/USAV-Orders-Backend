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
  const sidebarSearch = params.search || '';
  const manualMode = (params.manualMode as 'category' | 'orders') || 'category';
  const categoryId = params.categoryId || '';
  const orderId = params.orderId || '';

  const isManuals = activeTab === 'manuals';

  return (
    <div className={`flex h-full w-full bg-gray-50 ${isManuals ? 'overflow-hidden' : ''}`}>
      <div className={`flex-1 min-w-0 ${isManuals ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
        {isManuals ? (
          <ManualAssignmentTab
            manualMode={manualMode}
            categoryId={categoryId}
            orderId={orderId}
            searchValue={sidebarSearch}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
