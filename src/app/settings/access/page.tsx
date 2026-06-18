import { StaffAccessMatrixTab } from '@/components/admin/StaffAccessMatrixTab';
import { requirePermission } from '@/lib/auth/page-guard';

export default async function SettingsAccessPage() {
  await requirePermission('admin.view', { enforce: true });
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <StaffAccessMatrixTab />
    </div>
  );
}
