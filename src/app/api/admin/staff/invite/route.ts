/**
 * POST /api/admin/staff/invite
 *
 * Creates a pending staff row + an enrollment token, then emails the
 * invitee a link to set their PIN. Returns the enrollment URL so the
 * caller can also show it as a copy-able link or QR (the existing
 * /m/enroll/[token] page already accepts these tokens).
 *
 * Body: { name, role, email }
 *
 * Gated by admin.manage_staff and tenant-scoped via ctx.organizationId.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { sendEmailBestEffort } from '@/lib/email/send';
import { getOrganization } from '@/lib/tenancy/organizations';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';
import { wouldExceedPlanCeiling, planLimitResponseBody } from '@/lib/billing/plan-ceilings';

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(50),
  email: z.string().trim().email().optional(),
});

function makeToken(): string {
  return randomBytes(24).toString('base64url');
}

export const POST = withAuth(async (req, ctx) => {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  // Normalize the requested role to a canonical key so it matches a row in
  // `roles` (rejects e.g. typos and aliases that wouldn't resolve).
  const canonical = canonicalRole(parsed.role.toLowerCase() as StaffRole);
  if (canonical === 'unknown' || !ALL_ROLES.includes(canonical)) {
    return NextResponse.json({ error: 'INVALID_ROLE', allowed: ALL_ROLES }, { status: 400 });
  }

  // Plan ceiling: an invite creates an active staff row (a seat). Dormant until
  // PLAN_FEATURE_ENFORCED; dogfood org exempt; fail-open (see plan-ceilings.ts).
  if (await wouldExceedPlanCeiling(ctx.organizationId, 'maxStaff')) {
    return NextResponse.json(planLimitResponseBody('maxStaff'), { status: 403 });
  }

  const token = makeToken();
  const newStaffId = await withTenantTransaction(ctx.organizationId, async (client) => {
    const staffRes = await client.query<{ id: number }>(
      `INSERT INTO staff (name, role, organization_id, active, status, default_home_path)
       VALUES ($1, $2, $3, true, 'invited', '/dashboard')
       RETURNING id`,
      [parsed.name, canonical, ctx.organizationId],
    );
    const id = staffRes.rows[0]!.id;

    // Assign the matching role in `staff_roles` — effective permissions are
    // resolved from this junction, not the `staff.role` column. Without it the
    // invited staff would enroll into an account with zero permissions and 403
    // on every gated route.
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id, granted_at, granted_by)
       SELECT $1, r.id, NOW(), $3 FROM roles r WHERE r.key = $2
       ON CONFLICT (staff_id, role_id) DO NOTHING`,
      [id, canonical, ctx.staffId ?? null],
    );

    await client.query(
      `INSERT INTO staff_enrollments (token, staff_id, created_by, expires_at)
       VALUES ($1, $2, $3, now() + interval '14 days')`,
      [token, id, ctx.staffId],
    );

    return id;
  });
  invalidateStaffRolesCache(newStaffId);

  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const inviteUrl = `${origin}/m/enroll/${token}`;

  if (parsed.email) {
    const org = await getOrganization(ctx.organizationId);
    void sendEmailBestEffort({
      to: parsed.email,
      subject: `You've been invited to ${org?.name ?? 'a workspace'}`,
      text:
        `Hi ${parsed.name},\n\n` +
        `${ctx.user.session.staffId ? 'A teammate' : 'An admin'} has invited you to join ${org?.name ?? 'their workspace'}.\n\n` +
        `Open this link on your phone to set up your PIN and sign in:\n` +
        `  ${inviteUrl}\n\n` +
        `This link expires in 14 days.\n`,
    });
  }

  return NextResponse.json({
    staffId: newStaffId,
    enrollmentToken: token,
    enrollmentUrl: inviteUrl,
    expiresInDays: 14,
  });
}, {
  permission: 'admin.manage_staff',
  audit: {
    source: 'admin',
    action: 'staff.invite',
    entityType: 'staff',
    entityId: ({ response }) => (response as { staffId?: number })?.staffId ?? null,
  },
});
