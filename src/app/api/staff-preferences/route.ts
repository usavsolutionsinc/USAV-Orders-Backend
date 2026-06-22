/**
 * /api/staff-preferences — the logged-in staffer's own UI preferences.
 *
 * Like /api/staff-todos, no special permission: every authenticated staffer
 * reads and writes only their OWN prefs; staffId + org always come from the
 * verified session, never the request body.
 *
 *   GET  → { prefs: StaffPreferences }
 *   PUT  { focusScanHotkey?: 'F1'..'F12' | null } → { prefs }  (partial merge)
 *
 * First consumer: the configurable focus-scan hotkey shared by every
 * StationScanBar across the app.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { StaffPreferencesPutBody } from '@/lib/schemas/staff-preferences';
import {
  getStaffPreferences,
  updateStaffPreferences,
} from '@/lib/neon/staff-preferences-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const runtime = 'nodejs';

const AUDIT_SOURCE = 'staff-preferences-api';

export const GET = withAuth(async (_req, ctx) => {
  const prefs = await getStaffPreferences(ctx.staffId, ctx.organizationId);
  return NextResponse.json({ prefs });
});

export const PUT = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(StaffPreferencesPutBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const before = await getStaffPreferences(ctx.staffId, ctx.organizationId);
  const prefs = await updateStaffPreferences(ctx.staffId, ctx.organizationId, parsed);

  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.STAFF_PREFERENCE_UPDATE,
    entityType: AUDIT_ENTITY.STAFF_PREFERENCE,
    entityId: ctx.staffId,
    before: before as Record<string, unknown>,
    after: prefs as Record<string, unknown>,
  });

  return NextResponse.json({ prefs });
});
