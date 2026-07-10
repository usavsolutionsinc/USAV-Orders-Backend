/**
 * /api/org/invitations
 *
 *   POST  — create an org invitation (invite by email) and email a join link.
 *   GET   — list pending invitations for the current org.
 *
 * Both gated by admin.manage_staff and tenant-scoped via ctx.organizationId.
 * The accept side is public: /api/auth/invitation/accept + /invite/[token].
 *
 * See docs/identity-layer-plan.md.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { sendEmailBestEffort } from '@/lib/email/send';
import { getOrganization } from '@/lib/tenancy/organizations';
import { resolveAccountIdForStaff } from '@/lib/identity/memberships';
import {
  createInvitation,
  listPendingInvitations,
  InvitationError,
} from '@/lib/identity/invitations';
import { wouldExceedPlanCeiling, planLimitResponseBody } from '@/lib/billing/plan-ceilings';

const Body = z.object({
  email: z.string().trim().email(),
  role: z.string().trim().min(1).max(50).optional(),
});

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
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

  // Plan ceiling: an accepted invitation becomes a staff seat, so gate at
  // invite time. Dormant until PLAN_FEATURE_ENFORCED; dogfood org exempt;
  // fail-open (see plan-ceilings.ts).
  if (await wouldExceedPlanCeiling(ctx.organizationId, 'maxStaff')) {
    return NextResponse.json(planLimitResponseBody('maxStaff'), { status: 403 });
  }

  const invitedByAccountId = await resolveAccountIdForStaff(ctx.staffId);

  let invite: { id: string; token: string; roleKey: string };
  try {
    invite = await createInvitation({
      orgId: ctx.organizationId,
      email: parsed.email,
      roleKey: parsed.role ?? null,
      invitedByAccountId,
    });
  } catch (err) {
    if (err instanceof InvitationError && err.code === 'INVALID_ROLE') {
      return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 });
    }
    throw err;
  }

  const inviteUrl = `${appOrigin()}/invite/${invite.token}`;

  const org = await getOrganization(ctx.organizationId);
  void sendEmailBestEffort({
    to: parsed.email,
    subject: `You've been invited to ${org?.name ?? 'a workspace'}`,
    text:
      `You've been invited to join ${org?.name ?? 'a workspace'} as ${invite.roleKey}.\n\n` +
      `Open this link to set up your account and sign in:\n` +
      `  ${inviteUrl}\n\n` +
      `This link expires in 14 days.\n`,
  });

  return NextResponse.json({
    id: invite.id,
    role: invite.roleKey,
    inviteUrl,
    expiresInDays: 14,
  });
}, {
  permission: 'admin.manage_staff',
  audit: {
    source: 'admin',
    action: 'org.invitation.create',
    entityType: 'org_invitation',
    entityId: ({ response }) => (response as { id?: string })?.id ?? null,
  },
});

export const GET = withAuth(async (_req, ctx) => {
  const invitations = await listPendingInvitations(ctx.organizationId);
  return NextResponse.json({ invitations });
}, { permission: 'admin.manage_staff' });
