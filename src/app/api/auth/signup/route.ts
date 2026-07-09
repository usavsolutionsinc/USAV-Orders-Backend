/**
 * POST /api/auth/signup
 *
 * Self-service tenant provisioning. Creates an organization, the first
 * admin staff, hashes their PIN, opens a session, and (best-effort) sends
 * a welcome email + creates a Stripe customer for the 14-day trial.
 *
 * Public (no session required, no permission). Throttled by IP because
 * this is a free-tier creation endpoint and we don't want it spammed.
 *
 * Body:
 *   { companyName: string, slug?: string, fullName: string, email: string,
 *     pin: string (4-12 digits) }
 *
 * Response: sets the usav_sid cookie and returns { orgId, slug, staffId,
 *           defaultHomePath: '/dashboard' }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { createSession, SESSION_COOKIE_NAME, cookieMaxAgeForSession } from '@/lib/auth/session';
import { hashPin, isObviousPin } from '@/lib/auth/pin';
import { getOrganizationBySlug } from '@/lib/tenancy/organizations';
import { getAccountByEmail, createAccount } from '@/lib/identity/accounts';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { sendEmailBestEffort } from '@/lib/email/send';
import { createStripeCustomer } from '@/lib/billing/stripe';
import { seedOrgCatalog } from '@/lib/neon/catalog-queries';
import { seedDefaultWorkflowForOrg } from '@/lib/studio/seed-org-workflow';
import { ensureAdminRoleWired } from '@/lib/auth/ensure-admin-role';
import {
  mintEmailVerificationToken,
  buildVerifyEmailLink,
  EMAIL_VERIFY_TTL_MINUTES,
} from '@/lib/auth/email-verification';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const SignupSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE).optional(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  pin: z.string().regex(/^\d{4,12}$/),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 0; n < 50; n++) {
    const existing = await getOrganizationBySlug(candidate);
    if (!existing) return candidate;
    candidate = `${base}-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  throw new Error('Could not allocate a unique workspace slug');
}

export const POST = withAuth(async (req: NextRequest) => {
  // Light IP throttle — 5 signups / 10 min per IP. Stops trivial abuse.
  const limited = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'auth-signup',
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSec: limited.retryAfterSec },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof SignupSchema>;
  try {
    parsed = SignupSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  if (isObviousPin(parsed.pin)) {
    return NextResponse.json({ error: 'WEAK_PIN' }, { status: 400 });
  }

  const slug = await uniqueSlug(parsed.slug ?? slugify(parsed.companyName));

  const client = await pool.connect();
  let staffId: number;
  let orgId: string;
  let accountId: string;
  try {
    await client.query('BEGIN');

    // 1. Org
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, plan, status, trial_ends_at, settings, billing_email)
       VALUES ($1, $2, 'trial', 'active', now() + interval '14 days', '{}'::jsonb, $3)
       RETURNING id`,
      [slug, parsed.companyName, parsed.email],
    );
    orgId = orgRes.rows[0]!.id;

    // 2. Global identity account for the owner (email-backed; null password —
    // they sign in via PIN below or a future magic-link). Find-or-create by
    // email so a human who already has an account (e.g. invited elsewhere)
    // converges onto one cross-org identity rather than orphaning a duplicate
    // — account_emails enforces a single account per email. Mirrors the
    // invitation-accept flow (src/lib/identity/invitations.ts). Inside the tx so
    // a failure rolls back the whole signup.
    const existingAccount = await getAccountByEmail(parsed.email, client);
    accountId = existingAccount
      ? existingAccount.id
      : await createAccount(
          { displayName: parsed.fullName, email: parsed.email, password: null },
          client,
        );

    // 3. Membership linking the account to the new org as an active member.
    const memRes = await client.query<{ id: string }>(
      `INSERT INTO memberships (account_id, org_id, status, joined_at)
       VALUES ($1, $2, 'active', now())
       ON CONFLICT (account_id, org_id)
       DO UPDATE SET status = 'active', joined_at = COALESCE(memberships.joined_at, now())
       RETURNING id`,
      [accountId, orgId],
    );
    const membershipId = memRes.rows[0]!.id;

    // 4. First admin staff (the per-org profile), linked to account + membership.
    const pinHash = await hashPin(parsed.pin);
    const staffRes = await client.query<{ id: number }>(
      `INSERT INTO staff
         (name, role, active, organization_id, pin_hash, pin_set_at, status, default_home_path, email,
          account_id, membership_id)
       VALUES ($1, 'admin', true, $2, $3, now(), 'active', '/dashboard', $4, $5, $6)
       RETURNING id`,
      [parsed.fullName, orgId, pinHash, parsed.email, accountId, membershipId],
    );
    staffId = staffRes.rows[0]!.id;

    // 5. Wire to the admin role (if the roles taxonomy exists in this DB)
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.key = 'admin'
       ON CONFLICT DO NOTHING`,
      [staffId],
    );

    // 5b. WS2.2 — admin-role self-heal. The wire above silently no-ops on a fresh
    // DB whose global `roles` table was never seeded, leaving the admin with no
    // permissions. ensureAdminRoleWired seeds the admin role row (idempotent) and
    // retries the wire so the first admin ALWAYS ends up with the admin role.
    // Runs on this transaction client → shares the signup commit/rollback.
    await ensureAdminRoleWired(staffId, client);

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    console.error('[signup] db error:', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // 4. Mint the session for the new admin
  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'signup',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent'),
  });

  // 4b. Audit the tenant-creation event. Signup is anonymous (ctx=null), so we
  // attribute it to the freshly-minted admin + new org via the overrides. Best
  // effort — recordAudit never throws and must not break signup.
  await recordAudit(pool, null, req, {
    source: 'auth-signup',
    action: AUDIT_ACTION.ORG_CREATE,
    entityType: AUDIT_ENTITY.ORGANIZATION,
    entityId: orgId,
    actorStaffIdOverride: staffId,
    organizationIdOverride: orgId,
    method: 'system',
    after: { slug, name: parsed.companyName, plan: 'trial', adminStaffId: staffId, ownerAccountId: accountId },
  });

  // 5. Side-effects (best-effort, must not break the signup)
  // Seed the org's editable platform/account/type catalog so a fresh tenant isn't
  // blank — `createOrganization` does this, but signup uses a direct INSERT above,
  // so it was being skipped. Best-effort: a seed failure must not block signup.
  void seedOrgCatalog(orgId).catch((err) =>
    console.error('[signup] seedOrgCatalog failed for new org', orgId, err),
  );
  // Clone + activate the default system workflow so the engine can route intake
  // for the new tenant out-of-the-box (F4-lite). Best-effort.
  void seedDefaultWorkflowForOrg(orgId, staffId).catch((err) =>
    console.error('[signup] seedDefaultWorkflowForOrg failed for new org', orgId, err),
  );

  // WS6.3 — welcome email + email verification. The verification link reuses the
  // F1 magic-link token store (email_login_tokens); clicking it confirms the email
  // (sets account_emails.verified_at) and signs the owner in. Best-effort: a mint
  // failure must not break signup and still sends the welcome email (sans link).
  void (async () => {
    let verifyLine = '';
    try {
      const { token } = await mintEmailVerificationToken({ organizationId: orgId, staffId });
      verifyLine =
        `Confirm your email — this link also signs you in, valid for ${EMAIL_VERIFY_TTL_MINUTES} minutes:\n` +
        `  ${buildVerifyEmailLink(token)}\n\n`;
    } catch (err) {
      console.error('[signup] verification token mint failed for new org', orgId, err);
    }
    void sendEmailBestEffort({
      to: parsed.email,
      subject: `Welcome to ${parsed.companyName}`,
      text:
        `Hi ${parsed.fullName},\n\n` +
        `Your workspace "${parsed.companyName}" is ready. Your URL is:\n` +
        `  ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.example.com'}/dashboard\n\n` +
        verifyLine +
        `You're on a 14-day trial. Invite teammates from the admin panel.\n`,
    });
  })();

  if (process.env.STRIPE_SECRET_KEY) {
    // Provision the Stripe customer up front so the first upgrade attempt
    // doesn't have to wait on a round-trip. Best effort — billing still
    // works if this fails.
    createStripeCustomer({
      email: parsed.email,
      name: parsed.companyName,
      metadata: { organization_id: orgId, slug },
    })
      .then(async ({ id }) => {
        await pool.query(
          `UPDATE organizations SET stripe_customer_id = $1, updated_at = now() WHERE id = $2`,
          [id, orgId],
        );
      })
      .catch((err) => console.warn('[signup] stripe customer create failed:', err));
  }

  const res = NextResponse.json({
    orgId,
    slug,
    staffId,
    defaultHomePath: '/dashboard',
  });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.sid,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeForSession(session),
  });
  return res;
}, { allowAnonymous: true });
