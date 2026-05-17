import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/page-guard';
import { AuditLogStaffClient } from '@/components/audit-log/AuditLogStaffClient';
import { AuditLogSidebarPanel } from '@/components/sidebar/AuditLogSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';

export const dynamic = 'force-dynamic';

export default async function AuditLogStaffPage() {
  await requirePermission('admin.view_logs');

  return (
    <Suspense>
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
        <RouteShell
          actions={<AuditLogSidebarPanel />}
          history={<AuditLogStaffClient />}
        />
      </div>
    </Suspense>
  );
}
