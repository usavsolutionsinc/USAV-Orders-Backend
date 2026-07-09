import { OrganizationSection } from '@/components/settings/sections/OrganizationSection';
import { requirePermission } from '@/lib/auth/page-guard';

export default async function OrganizationSettingsPage() {
  await requirePermission('admin.view', { enforce: true });
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-canvas">
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          <OrganizationSection />
        </div>
      </main>
    </div>
  );
}
