/**
 * /settings/staff — tenant staff directory + invite UI.
 *
 * Server component for the table; client island for the invite form. The
 * shape intentionally mirrors /settings/billing and /settings/integrations
 * so the three pages feel like one product, not three.
 *
 * Gated by admin.manage_staff at the page level — only admins can manage
 * their teammates.
 */

import { requirePermission } from '@/lib/auth/page-guard';
import pool from '@/lib/db';
import { PageHeader } from '@/components/ui/pane-header';
import { StaffTable } from './StaffTable';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  status: string;
  active: boolean;
  has_pin: boolean;
  last_login_at: Date | null;
  default_home_path: string | null;
  color_hex: string;
}

export default async function StaffPage() {
  const user = await requirePermission('admin.manage_staff');
  const r = await pool.query<StaffRow>(
    `SELECT id, name, role, status, COALESCE(active, true) AS active,
            (pin_hash IS NOT NULL) AS has_pin,
            last_login_at, default_home_path, color_hex
       FROM staff
      WHERE organization_id = $1
      ORDER BY active DESC, status ASC, name ASC`,
    [user.organizationId],
  );

  return (
    <div className="min-h-screen bg-gray-50 antialiased">
      <PageHeader title="Team" maxWidth="5xl" />
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <p className="text-[13px] text-gray-500">
          Invite teammates, change roles, deactivate access. Active sessions are revoked the moment you deactivate.
        </p>

        <StaffTable initialStaff={r.rows.map((s) => ({
          ...s,
          last_login_at: s.last_login_at ? s.last_login_at.toISOString() : null,
        }))} />
      </div>
    </div>
  );
}
