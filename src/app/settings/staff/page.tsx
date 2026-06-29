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
  auth_method: string;
  requires_sensitive_stepup: boolean;
}

export default async function StaffPage() {
  const user = await requirePermission('admin.manage_staff');
  // auth_method / requires_sensitive_stepup (WS6.1) via to_jsonb so this query
  // is safe BEFORE the 2026-06-28_staff_auth_policy migration applies (missing
  // column → NULL key → COALESCE default 'pin' / false).
  const r = await pool.query<StaffRow>(
    `SELECT s.id, s.name, s.role, s.status, COALESCE(s.active, true) AS active,
            (s.pin_hash IS NOT NULL) AS has_pin,
            s.last_login_at, s.default_home_path, s.color_hex,
            COALESCE(to_jsonb(s) ->> 'auth_method', 'pin') AS auth_method,
            COALESCE((to_jsonb(s) ->> 'requires_sensitive_stepup')::boolean, false) AS requires_sensitive_stepup
       FROM staff s
      WHERE s.organization_id = $1
      ORDER BY s.active DESC, s.status ASC, s.name ASC`,
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
