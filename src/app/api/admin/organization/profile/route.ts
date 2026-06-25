import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, updateOrgSettings } from '@/lib/tenancy/organizations';
import type { OrgSettings } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function profilePayload(settings: OrgSettings) {
  return {
    timezone: settings.timezone,
    currency: settings.currency,
    locale: settings.locale,
    emailFirstSignin: settings.emailFirstSignin,
    requirePasskeyForNewStaff: settings.requirePasskeyForNewStaff,
    maxConcurrentSessions: settings.maxConcurrentSessions,
    warrantyDays: settings.warrantyDays,
    packing: settings.packing ?? { enforcement: 'advisory' as const },
    brand: settings.brand ?? {},
  };
}

/** GET → org profile fields from organizations.settings jsonb. */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const org = await getOrganization(ctx.organizationId as OrgId);
  const settings = org?.settings;
  if (!settings) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  return NextResponse.json(profilePayload(settings));
}, { permission: 'admin.view' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Partial<OrgSettings> = {};
  const b = body as Record<string, unknown>;

  if (typeof b.timezone === 'string' && b.timezone.trim()) {
    patch.timezone = b.timezone.trim();
  }
  if (typeof b.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency.trim())) {
    patch.currency = b.currency.trim().toUpperCase();
  }
  if (typeof b.locale === 'string' && b.locale.trim()) {
    patch.locale = b.locale.trim();
  }
  if (typeof b.emailFirstSignin === 'boolean') {
    patch.emailFirstSignin = b.emailFirstSignin;
  }
  if (typeof b.requirePasskeyForNewStaff === 'boolean') {
    patch.requirePasskeyForNewStaff = b.requirePasskeyForNewStaff;
  }
  if (typeof b.maxConcurrentSessions === 'number' && Number.isInteger(b.maxConcurrentSessions) && b.maxConcurrentSessions >= 0) {
    patch.maxConcurrentSessions = b.maxConcurrentSessions;
  }
  if (typeof b.warrantyDays === 'number' && Number.isInteger(b.warrantyDays) && b.warrantyDays >= 1 && b.warrantyDays <= 3650) {
    patch.warrantyDays = b.warrantyDays;
  }
  if (b.packing != null && typeof b.packing === 'object' && !Array.isArray(b.packing)) {
    const mode = (b.packing as Record<string, unknown>).enforcement;
    patch.packing = {
      enforcement: mode === 'block_until_matched' ? 'block_until_matched' : 'advisory',
    };
  }
  if (b.brand != null && typeof b.brand === 'object' && !Array.isArray(b.brand)) {
    const brand = b.brand as Record<string, unknown>;
    const nextBrand: NonNullable<OrgSettings['brand']> = {};
    if (typeof brand.name === 'string' && brand.name.trim()) nextBrand.name = brand.name.trim();
    if (typeof brand.logoUrl === 'string' && brand.logoUrl.trim()) nextBrand.logoUrl = brand.logoUrl.trim();
    if (typeof brand.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor.trim())) {
      nextBrand.primaryColor = brand.primaryColor.trim();
    }
    patch.brand = nextBrand;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  await updateOrgSettings(ctx.organizationId as OrgId, patch);
  const org = await getOrganization(ctx.organizationId as OrgId);
  return NextResponse.json({ ok: true, ...profilePayload(org!.settings) });
}, { permission: 'admin.view' });
