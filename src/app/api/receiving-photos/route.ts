import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl, getAllNasBaseUrls } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveOperatorNasFolder } from '@/lib/nas-photos-server';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { publishReceivingPhotoChanged } from '@/lib/realtime/publish';

export const dynamic = 'force-dynamic';

/**
 * Receiving photo endpoint.
 *
 * Photos are stored polymorphically on the `photos` table — same pattern used
 * for PACKER_LOG, SKU, BIN_ADJUSTMENT, etc.:
 *   PO-level photo   → entity_type='RECEIVING',      entity_id=receiving.id
 *   Item-level photo → entity_type='RECEIVING_LINE', entity_id=receiving_lines.id
 *
 * Photos live on the office NAS, not Vercel Blob. The browser writes the file
 * straight to the NAS over WebDAV (the Vercel server can't reach the LAN) and
 * then POSTs the resulting `photoUrl` here to link it — so this route only ever
 * stores a URL, never bytes.
 *
 * The POST body still talks in `receivingId` / `receivingLineId` because that's
 * how the mobile client thinks of scope; we translate to (entity_type,
 * entity_id) on insert and back to (receivingId, receivingLineId) on read.
 *
 * GET parameters:
 *   ?receivingId=N&receivingLineId=M → only that item's photos
 *   ?receivingId=N&scope=po          → only PO-level photos
 *   ?receivingId=N                   → every photo for the PO (PO-level
 *                                       UNION item-level on every line under N)
 */

interface PhotoRow {
  id: number;
  receivingId: number | null;
  receivingLineId: number | null;
  photoUrl: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface DbRow {
  id: number;
  entity_type: string;
  entity_id: number;
  receiving_id_resolved: number | null;
  url: string;
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
}

function mapRow(row: DbRow): PhotoRow {
  const isLine = row.entity_type === 'RECEIVING_LINE';
  return {
    id: Number(row.id),
    receivingId: row.receiving_id_resolved != null ? Number(row.receiving_id_resolved) : null,
    receivingLineId: isLine ? Number(row.entity_id) : null,
    photoUrl: normalizePhotoDisplayUrl(row.url),
    caption: row.caption || null,
    uploadedBy: row.uploaded_by != null ? Number(row.uploaded_by) : null,
    createdAt: row.created_at,
  };
}

// Resolve receiving_id whether the row is scoped to RECEIVING or RECEIVING_LINE.
// For RECEIVING rows it's entity_id itself; for RECEIVING_LINE rows we look it
// up through receiving_lines so callers can still pivot by PO/receiving package.
const SELECT_WITH_RID = `
  p.id, p.entity_type, p.entity_id,
  CASE
    WHEN p.entity_type = 'RECEIVING'      THEN p.entity_id
    WHEN p.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
    ELSE NULL
  END AS receiving_id_resolved,
  p.url, p.photo_type AS caption,
  p.taken_by_staff_id AS uploaded_by,
  p.created_at
`;

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const params = new URL(req.url).searchParams;
    const receivingId = Number(params.get('receivingId'));
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }

    const lineIdRaw = params.get('receivingLineId');
    const scope = params.get('scope');

    let where: string;
    const values: unknown[] = [];

    if (lineIdRaw != null) {
      const lineId = Number(lineIdRaw);
      if (!Number.isFinite(lineId) || lineId <= 0) {
        throw ApiError.badRequest('Valid receivingLineId is required');
      }
      where = `p.entity_type = 'RECEIVING_LINE' AND p.entity_id = $1`;
      values.push(lineId);
    } else if (scope === 'po') {
      where = `p.entity_type = 'RECEIVING' AND p.entity_id = $1`;
      values.push(receivingId);
    } else {
      // Combined: PO-level photos for this receiving package + item-level
      // photos for every receiving_lines row under it.
      where =
        `(p.entity_type = 'RECEIVING'      AND p.entity_id = $1) OR ` +
        `(p.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = $1)`;
      values.push(receivingId);
    }

    const result = await pool.query<DbRow>(
      `SELECT ${SELECT_WITH_RID}
         FROM photos p
         LEFT JOIN receiving_lines rl
                ON p.entity_type = 'RECEIVING_LINE'
               AND rl.id = p.entity_id
        WHERE ${where}
        ORDER BY p.created_at ASC`,
      values,
    );

    // Surface when this carton was physically scanned/received so the NAS picker
    // can anchor the "PO scan time" sort on the moment the photos were actually
    // taken. We deliberately prefer received_at / the first tracking-scan over
    // created_at: a receiving row can be pre-created (e.g. from a Zoho PO import)
    // long before the package is scanned, so created_at would anchor on a stale
    // time and surface the oldest photos in the folder. ISO/UTC so the client
    // can Date.parse it unambiguously against the NAS file mtimes.
    const cartonRes = await pool.query<{ created_at: string | null }>(
      `SELECT to_char(
                COALESCE(
                  r.received_at,
                  (SELECT MIN(rs.scanned_at) FROM receiving_scans rs WHERE rs.receiving_id = r.id),
                  r.created_at
                ) AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              ) AS created_at
         FROM receiving r WHERE r.id = $1 LIMIT 1`,
      [receivingId],
    );

    // Resolve the folder the picker should auto-open for THIS operator (their
    // primary station → the org's admin-configured `stationNasPhotoFolders`),
    // plus the active NAS base URL. Shared with GET /api/nas-config. '' folder =
    // open at the NAS root. Best-effort — never let a settings/station hiccup
    // break the photo strip.
    let initialNasFolder = '';
    let nasBaseUrl = '';
    try {
      const orgId = ctx.organizationId as OrgId;
      const [org, folder] = await Promise.all([
        getOrganization(orgId),
        resolveOperatorNasFolder(orgId, ctx.staffId),
      ]);
      initialNasFolder = folder;
      nasBaseUrl = org ? getActiveNasBaseUrl(org.settings) : '';
    } catch {
      initialNasFolder = '';
      nasBaseUrl = '';
    }

    return NextResponse.json({
      photos: result.rows.map(mapRow),
      receivingCreatedAt: cartonRes.rows[0]?.created_at ?? null,
      initialNasFolder,
      nasBaseUrl,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving-photos');
  }
}, { permission: 'receiving.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const receivingId = Number(body?.receivingId);
    const receivingLineIdRaw = body?.receivingLineId;
    const receivingLineId =
      receivingLineIdRaw != null && receivingLineIdRaw !== ''
        ? Number(receivingLineIdRaw)
        : null;
    const photoUrl: string = String(body?.photoUrl || '').trim();
    const caption = String(body?.caption || '').trim() || null;
    // Server-trusted actor — body.uploadedBy is ignored.
    const uploadedBy = ctx.staffId;

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (receivingLineId != null && (!Number.isFinite(receivingLineId) || receivingLineId <= 0)) {
      throw ApiError.badRequest('Valid receivingLineId is required when provided');
    }
    if (!photoUrl) {
      throw ApiError.badRequest('photoUrl is required');
    }

    // Origin allowlist: once a NAS base is known for this org, a receiving photo
    // URL must point at it (test or prod) — or the same-origin dev proxy. This is
    // the security boundary now that the route trusts a client-supplied URL
    // instead of uploading bytes itself: it stops arbitrary external URLs from
    // being pinned onto a PO. When NOTHING is configured (no settings slot, no
    // env), we stay permissive so un-migrated orgs keep working.
    const org = await getOrganization(ctx.organizationId as OrgId);
    const allowedBases = org ? getAllNasBaseUrls(org.settings) : [];
    const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
    if (envBase && !envBase.startsWith('/')) allowedBases.push(envBase);
    const isSameOrigin = photoUrl.startsWith('/'); // e.g. /api/nas-dev (dev proxy)
    const isAllowed =
      allowedBases.length === 0 ||
      isSameOrigin ||
      allowedBases.some((base) => photoUrl === base || photoUrl.startsWith(`${base}/`));
    if (!isAllowed) {
      throw ApiError.badRequest('photoUrl must point at the configured NAS address');
    }

    const entityType = receivingLineId != null ? 'RECEIVING_LINE' : 'RECEIVING';
    const entityId = receivingLineId ?? receivingId;

    const finalUrl = photoUrl;
    const photoType = caption || (receivingLineId != null ? 'receiving_item' : 'receiving');

    const inserted = await pool.query(
      `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (entity_type, entity_id, url) DO NOTHING
       RETURNING id`,
      [entityType, entityId, finalUrl, uploadedBy, photoType],
    );

    if (inserted.rowCount === 0) throw ApiError.conflict('Photo already exists');

    // Re-read with the receiving_id resolver so the response matches GET shape.
    const read = await pool.query<DbRow>(
      `SELECT ${SELECT_WITH_RID}
         FROM photos p
         LEFT JOIN receiving_lines rl
                ON p.entity_type = 'RECEIVING_LINE'
               AND rl.id = p.entity_id
        WHERE p.id = $1`,
      [inserted.rows[0].id],
    );

    const photo = mapRow(read.rows[0]);
    await publishReceivingPhotoChanged({
      organizationId: ctx.organizationId as OrgId,
      action: 'insert',
      receivingId,
      receivingLineId,
      photoId: photo.id,
      source: 'receiving-photos.post',
    });

    return NextResponse.json({ success: true, photo });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-photos');
  }
}, { permission: 'receiving.upload_photo' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      throw ApiError.badRequest('Valid id is required');
    }

    const existing = await pool.query<{
      entity_type: string;
      entity_id: number;
      receiving_id_resolved: number | null;
    }>(
      `SELECT p.entity_type, p.entity_id,
              CASE
                WHEN p.entity_type = 'RECEIVING'      THEN p.entity_id
                WHEN p.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
                ELSE NULL
              END AS receiving_id_resolved
         FROM photos p
         LEFT JOIN receiving_lines rl
                ON p.entity_type = 'RECEIVING_LINE'
               AND rl.id = p.entity_id
        WHERE p.id = $1
          AND p.entity_type IN ('RECEIVING', 'RECEIVING_LINE')`,
      [id],
    );
    if (existing.rowCount === 0) throw ApiError.notFound('photo', id);
    const existingPhoto = existing.rows[0];

    // Photos live on the NAS now. Deleting just unlinks the DB row; the file
    // stays on the NAS share (same behavior the NAS picker has always had).
    // Legacy rows may still hold a Vercel Blob URL from before the migration —
    // those are left untouched too.
    await pool.query(`DELETE FROM photos WHERE id = $1`, [id]);

    if (existingPhoto?.receiving_id_resolved) {
      await publishReceivingPhotoChanged({
        organizationId: ctx.organizationId as OrgId,
        action: 'delete',
        receivingId: Number(existingPhoto.receiving_id_resolved),
        receivingLineId:
          existingPhoto.entity_type === 'RECEIVING_LINE' ? Number(existingPhoto.entity_id) : null,
        photoId: id,
        source: 'receiving-photos.delete',
      });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/receiving-photos');
  }
}, { permission: 'receiving.upload_photo' });
