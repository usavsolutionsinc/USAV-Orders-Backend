import { RolesAdminTab } from '@/components/admin/RolesAdminTab';
import { requirePermission } from '@/lib/auth/page-guard';

export default async function SettingsRolesPage() {
  await requirePermission('admin.manage_roles', { enforce: true });
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <RolesAdminTab />
    </div>
  );
}
