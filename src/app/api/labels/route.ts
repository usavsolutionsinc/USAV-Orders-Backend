import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { LABEL_DEFAULTS, TONE_CLASSES, isLabelTone } from '@/lib/labels/registry';
import { resolveKind } from '@/lib/labels/resolve';
import { loadLabelOverrides } from '@/lib/labels/load';
import { upsertLabelOverride, deleteLabelOverride } from '@/lib/labels/store';
import type { LabelKind } from '@/lib/labels/types';

/**
 * Tenant-customizable lifecycle LABELS — the Studio editor backend.
 *
 * The label LAYER lets a reseller rename / recolor a lifecycle stage's display
 * label without touching the stable `code` the engine + analytics key on
 * (docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md). Overrides
 * persist as `reason_codes` rows in a `lifecycle_<kind>` vocabulary; defaults
 * live in src/lib/labels/registry.ts. Reads gate on studio.view, writes on
 * studio.manage (the same permissions as the rest of Studio authoring).
 */

const KINDS = Object.keys(LABEL_DEFAULTS) as LabelKind[];
function parseKind(v: unknown): LabelKind | null {
  return typeof v === 'string' && (KINDS as string[]).includes(v) ? (v as LabelKind) : null;
}

/** GET /api/labels?kind=unshipped → resolved labels (defaults + this org's overrides). */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  const kind = parseKind(new URL(request.url).searchParams.get('kind'));
  if (!kind) {
    return NextResponse.json({ success: false, error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
  }
  // Degrade-not-fail: loader swallows a pre-migration / unreachable DB → defaults.
  const overrides = await withTenantTransaction(ctx.organizationId, (db) =>
    loadLabelOverrides(ctx.organizationId, db),
  );
  const labels = resolveKind(kind, { overrides });
  return NextResponse.json({ success: true, kind, labels, tones: Object.keys(TONE_CLASSES) });
}, { permission: 'studio.view' });

/** PUT /api/labels  { kind, code, label, tone? } → upsert this org's override. */
export const PUT = withAuth(async (request: NextRequest, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const kind = parseKind(body.kind);
  if (!kind) return NextResponse.json({ success: false, error: 'invalid kind' }, { status: 400 });

  const code = String(body.code ?? '');
  // The stable code must already exist — the label API relabels codes, it never
  // invents or renames them (the stable-code invariant, enforced at the write boundary).
  if (!LABEL_DEFAULTS[kind][code]) {
    return NextResponse.json({ success: false, error: `unknown code '${code}' for kind '${kind}'` }, { status: 404 });
  }
  const label = String(body.label ?? '').trim();
  if (!label) return NextResponse.json({ success: false, error: 'label is required' }, { status: 400 });

  let tone: ReturnType<typeof normTone>;
  try {
    tone = normTone(body.tone);
  } catch {
    return NextResponse.json({ success: false, error: 'invalid tone' }, { status: 400 });
  }

  const id = await withTenantTransaction(ctx.organizationId, (db) =>
    upsertLabelOverride(db, ctx.organizationId, { kind, code, label, tone }),
  );

  await recordAudit(pool, ctx, request, {
    source: 'labels-api',
    action: AUDIT_ACTION.REASON_CODE_UPDATE,
    entityType: AUDIT_ENTITY.REASON_CODE,
    entityId: id,
    after: { label, tone: tone ?? null },
    extra: { scope: 'lifecycle_label', kind, code },
  });

  return NextResponse.json({ success: true, id });
}, { permission: 'studio.manage' });

/** DELETE /api/labels?kind=&code= → drop the override (revert to default). */
export const DELETE = withAuth(async (request: NextRequest, ctx) => {
  const sp = new URL(request.url).searchParams;
  const kind = parseKind(sp.get('kind'));
  const code = String(sp.get('code') ?? '');
  if (!kind || !code) return NextResponse.json({ success: false, error: 'kind and code are required' }, { status: 400 });

  const removed = await withTenantTransaction(ctx.organizationId, (db) =>
    deleteLabelOverride(db, ctx.organizationId, kind, code),
  );

  if (removed) {
    await recordAudit(pool, ctx, request, {
      source: 'labels-api',
      action: AUDIT_ACTION.REASON_CODE_DELETE,
      entityType: AUDIT_ENTITY.REASON_CODE,
      entityId: `${kind}:${code}`,
      extra: { scope: 'lifecycle_label', kind, code },
    });
  }
  return NextResponse.json({ success: true, removed });
}, { permission: 'studio.manage' });

/** Validate the optional tone field; throws on a bad token, returns null when absent. */
function normTone(v: unknown) {
  if (v === undefined || v === null || v === '') return null;
  if (isLabelTone(v)) return v;
  throw new Error('invalid tone');
}
