import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  BUILTIN_IMAGE_TYPES,
  createImageType,
  listCustomImageTypes,
  ImageTypeConflictError,
  ImageTypeValidationError,
} from '@/lib/photos/image-types';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/photos/image-types — built-in scopes + the org's custom types.
 * Degrade-not-fail: the built-ins always return even if the custom-type query
 * errors (e.g. the table not yet migrated), so the sidebar never loses its
 * primary navigator.
 */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  let custom: Awaited<ReturnType<typeof listCustomImageTypes>> = [];
  try {
    custom = await listCustomImageTypes(ctx.organizationId);
  } catch (error) {
    console.error('GET /api/photos/image-types: custom types unavailable:', error);
  }
  return NextResponse.json({ builtIn: BUILTIN_IMAGE_TYPES, custom });
}, { permission: 'photos.view' });

/** POST /api/photos/image-types — create a custom image type. Body: { label, icon? }. */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { label?: unknown; icon?: unknown };
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) {
      return NextResponse.json({ error: 'A name is required' }, { status: 400 });
    }
    const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : null;

    const imageType = await createImageType(ctx.organizationId, { label, icon });

    await recordAudit(pool, ctx, req, {
      source: 'photo-image-types-api',
      action: AUDIT_ACTION.PHOTO_IMAGE_TYPE_CREATE,
      entityType: AUDIT_ENTITY.PHOTO_IMAGE_TYPE,
      entityId: imageType.id,
      after: { key: imageType.key, label: imageType.label, gcsPrefix: imageType.gcsPrefix },
    });

    return NextResponse.json({ imageType }, { status: 201 });
  } catch (error) {
    if (error instanceof ImageTypeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ImageTypeValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('POST /api/photos/image-types failed:', error);
    return NextResponse.json({ error: 'Failed to create image type' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
