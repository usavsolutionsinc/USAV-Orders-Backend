/**
 * /api/settings — the generic Settings Registry endpoint.
 *
 *   GET  ?page=receiving → { page, plan, canManageOrg, items: ResolvedSetting[] }
 *   PUT  { key, value, target? } → { ok, item }   (target 'org' | 'staff')
 *
 * One route serves every page and every setting. Each setting carries its own
 * permission + entitlement in the registry, so the route uses an auth-only
 * wrapper and enforces PER-SETTING inside the handler (a single route-level
 * permission can't express the mix). Values are validated against the registry
 * schema and written as flat namespaced keys into the org/staff JSONB bags via
 * the raw mergers. See docs/settings-registry.md.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import type { PermissionString } from '@/lib/auth/permissions';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { getOrganization, mergeOrgSettingsRaw } from '@/lib/tenancy/organizations';
import { getStaffPreferences, mergeStaffPreferencesRaw } from '@/lib/neon/staff-preferences-queries';
import { getEntitlements } from '@/lib/billing/entitlements';
import { isSettingPage, settingByKey, settingsForPage } from '@/lib/settings/registry';
import { resolveSetting } from '@/lib/settings/resolve';
import type { OrgId } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';

const AUDIT_SOURCE = 'settings-api';

const asRecord = (v: unknown): Record<string, unknown> =>
  (v ?? {}) as Record<string, unknown>;

export const GET = withAuth(async (req, ctx) => {
  const page = new URL(req.url).searchParams.get('page');
  if (!isSettingPage(page)) {
    return NextResponse.json({ error: 'UNKNOWN_PAGE', page }, { status: 400 });
  }

  const [org, staffPrefs, ent] = await Promise.all([
    getOrganization(ctx.organizationId as OrgId),
    getStaffPreferences(ctx.staffId, ctx.organizationId),
    getEntitlements(ctx.organizationId as OrgId),
  ]);

  const resolveCtx = {
    orgSettings: asRecord(org?.settings),
    staffPrefs: asRecord(staffPrefs),
    features: ent.features,
  };

  const items = settingsForPage(page).map((def) => resolveSetting(def, resolveCtx));
  const canManageOrg =
    ctx.permissions.has('admin.manage_features') || ctx.permissions.has('admin.view');

  return NextResponse.json({ page, plan: org?.plan ?? 'trial', canManageOrg, items });
});

interface PutBody {
  key?: unknown;
  value?: unknown;
  target?: unknown;
}

export const PUT = withAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as PutBody;
  const key = typeof body.key === 'string' ? body.key : '';
  const def = settingByKey(key);
  if (!def) return NextResponse.json({ error: 'UNKNOWN_SETTING', key }, { status: 404 });
  if (def.comingSoon) {
    return NextResponse.json({ error: 'SETTING_NOT_AVAILABLE', key }, { status: 409 });
  }

  // Validate the value against the registry schema (this also normalizes it).
  const parsed = def.schema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_VALUE', key, detail: parsed.error.issues?.[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const value = parsed.data as string | number | boolean;

  // Resolve the write target. staff-scope → staff; org-scope → org; an
  // org+personalizable setting may target 'staff' (the staffer's own override).
  const target: 'org' | 'staff' =
    def.scope === 'staff' || (body.target === 'staff' && def.personalizable) ? 'staff' : 'org';

  // Entitlement gates (whole-setting + per-option).
  const ent = await getEntitlements(ctx.organizationId as OrgId);
  if (def.entitlement && !ent.features[def.entitlement]) {
    return NextResponse.json(
      { ok: false, error: 'FEATURE_GATED', feature: def.entitlement, upgrade: true },
      { status: 403 },
    );
  }
  const optFeature = def.optionEntitlements?.[String(value)];
  if (optFeature && !ent.features[optFeature]) {
    return NextResponse.json(
      { ok: false, error: 'FEATURE_GATED', feature: optFeature, upgrade: true },
      { status: 403 },
    );
  }

  // Permission gate for org-scope writes (self-writes need none).
  if (target === 'org' && def.permission && !ctx.permissions.has(def.permission as PermissionString)) {
    return NextResponse.json({ error: 'FORBIDDEN', permission: def.permission }, { status: 403 });
  }

  // Capture the before-image of just this key for the audit diff.
  const before =
    target === 'org'
      ? asRecord((await getOrganization(ctx.organizationId as OrgId))?.settings)[key]
      : asRecord(await getStaffPreferences(ctx.staffId, ctx.organizationId))[key];

  if (target === 'org') {
    await mergeOrgSettingsRaw(ctx.organizationId as OrgId, { [key]: value });
  } else {
    await mergeStaffPreferencesRaw(ctx.staffId, ctx.organizationId, { [key]: value });
  }

  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.SETTINGS_UPDATE,
    entityType: AUDIT_ENTITY.SETTINGS,
    entityId: key,
    before: { [key]: before ?? null },
    after: { [key]: value },
    extra: { scope: target },
  });

  // Re-resolve for the response (reads both bags after the write).
  const [orgAfter, staffAfter] = await Promise.all([
    getOrganization(ctx.organizationId as OrgId),
    getStaffPreferences(ctx.staffId, ctx.organizationId),
  ]);
  const item = resolveSetting(def, {
    orgSettings: asRecord(orgAfter?.settings),
    staffPrefs: asRecord(staffAfter),
    features: ent.features,
  });

  return NextResponse.json({ ok: true, item });
});
