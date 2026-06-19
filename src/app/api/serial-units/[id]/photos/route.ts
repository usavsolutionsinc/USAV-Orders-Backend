import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl, getAllNasBaseUrls } from '@/lib/tenancy/settings';
import { resolveOperatorNasFolder } from '@/lib/nas-photos-server';
import { photoContentUrl } from '@/lib/photos/display-url';
import { attachPhotoWithLegacyUrl, listPhotosForEntity } from '@/lib/photos/service';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * Serial-unit photo endpoint — photos a packer captures when scanning a
 * pre-packed product's QR at the pack station. Linked via photo_entity_links
 * (entity_type='SERIAL_UNIT', entity_id=serial_units.id).
 *
 * Photos live on the office NAS (browser-direct WebDAV PUT), not Vercel Blob —
 * the same model receiving uses. This route never handles bytes; the browser
 * writes the file to the NAS and POSTs the resulting `photoUrl`(s) here to link.
 *
 * The `[id]` segment resolves a numeric serial_units.id, a serial_number, OR a
 * minted unit_uid ({SKU}-{YYWW}-{SEQ6}) — the last is what a scanned label QR
 * carries — so the same id a packer scans resolves here.
 *
 * GET  → { photos: [{id,url,photo_type,uploaded_by,created_at}], nasBaseUrl,
 *          initialNasFolder } — list + the NAS config the capture surface needs.
 * POST → attach one or many NAS photo URLs ({ photoUrl } or { photoUrls: [] }),
 *        then emit ONE `NOTE` inventory_event so the capture shows on the unit's
 *        timeline (the detail panel already renders inventory_events).
 */

function extractIdSegment(pathname: string): string {
  const m = /\/api\/serial-units\/([^/]+)\/photos/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}

/** Resolve [id] → a live serial_units row (numeric id → normalized serial → unit_uid). */
async function resolveUnit(raw: string): Promise<{ id: number; sku: string | null } | null> {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const r = await pool.query<{ id: number; sku: string | null }>(
      `SELECT id, sku FROM serial_units WHERE id = $1 LIMIT 1`,
      [Number(raw)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const bySerial = await pool.query<{ id: number; sku: string | null }>(
    `SELECT id, sku FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
    [raw],
  );
  if (bySerial.rows[0]) return bySerial.rows[0];
  const byUid = await pool.query<{ id: number; sku: string | null }>(
    `SELECT id, sku FROM serial_units WHERE unit_uid = $1 LIMIT 1`,
    [raw],
  );
  return byUid.rows[0] ?? null;
}

export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    try {
      const unit = await resolveUnit(extractIdSegment(request.nextUrl.pathname));
      if (!unit) {
        return NextResponse.json({ success: false, error: 'Serial unit not found' }, { status: 404 });
      }

      const rows = await listPhotosForEntity({
        organizationId: ctx.organizationId,
        entityType: 'SERIAL_UNIT',
        entityId: unit.id,
      });

      // The active NAS base + this operator's folder, so the capture surface can
      // PUT photos straight to the share. Best-effort — never let a settings
      // hiccup break the read.
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
        success: true,
        photos: rows.map((row) => ({
          id: row.id,
          url: row.url?.startsWith('/api/photos/') ? row.url : photoContentUrl(row.id),
          photoType: row.photoType,
          uploadedBy: row.takenByStaffId,
          createdAt: row.createdAt,
        })),
        nasBaseUrl,
        initialNasFolder,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load unit photos';
      console.error('GET /api/serial-units/[id]/photos:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.view' },
);

export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    try {
      const unit = await resolveUnit(extractIdSegment(request.nextUrl.pathname));
      if (!unit) {
        return NextResponse.json({ success: false, error: 'Serial unit not found' }, { status: 404 });
      }

      const body = await request.json().catch(() => null);
      if (!body) {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
      }

      const urls: string[] = Array.isArray(body.photoUrls)
        ? body.photoUrls.map((u: unknown) => String(u ?? '').trim()).filter(Boolean)
        : body.photoUrl
          ? [String(body.photoUrl).trim()].filter(Boolean)
          : [];
      if (urls.length === 0) {
        return NextResponse.json(
          { success: false, error: 'photoUrl or photoUrls is required' },
          { status: 400 },
        );
      }
      // 'shipout' (packer captured it at pack) by default; 'prepack' allowed.
      const stage = String(body.stage || 'shipout').trim() || 'shipout';

      // Origin allowlist — same security boundary receiving uses now that we
      // trust a client-supplied URL: it must point at the org's configured NAS
      // (test or prod) or the same-origin dev proxy. Permissive only when
      // NOTHING is configured, so un-migrated orgs keep working.
      const org = await getOrganization(ctx.organizationId as OrgId);
      const allowedBases = org ? getAllNasBaseUrls(org.settings) : [];
      const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
      if (envBase && !envBase.startsWith('/')) allowedBases.push(envBase);
      const isAllowed = (url: string) =>
        allowedBases.length === 0 ||
        url.startsWith('/') ||
        url.startsWith('/api/photos/') ||
        allowedBases.some((base) => url === base || url.startsWith(`${base}/`));
      const bad = urls.find((u) => !isAllowed(u));
      if (bad) {
        return NextResponse.json(
          { success: false, error: 'photoUrl must point at the configured NAS address' },
          { status: 400 },
        );
      }

      const insertedIds: number[] = [];
      for (const url of urls) {
        const attached = await attachPhotoWithLegacyUrl({
          organizationId: ctx.organizationId,
          staffId: ctx.staffId ?? null,
          entityType: 'SERIAL_UNIT',
          entityId: unit.id,
          legacyUrl: url,
          photoType: stage,
          idempotent: true,
        });
        if (attached.created) {
          insertedIds.push(attached.id);
        }
      }

      // One timeline marker per capture batch (not per photo) so the unit detail
      // timeline shows "N photo(s) captured" without spamming an event per shot.
      if (insertedIds.length > 0) {
        try {
          await recordInventoryEvent({
            event_type: 'NOTE',
            actor_staff_id: ctx.staffId ?? null,
            station: 'PACK',
            serial_unit_id: unit.id,
            sku: unit.sku,
            notes: `${insertedIds.length} ${stage} photo${insertedIds.length === 1 ? '' : 's'} captured`,
            payload: { source: 'serial-unit-photos', stage, photo_ids: insertedIds },
          });
        } catch (err) {
          console.warn('[serial-unit photos] NOTE event failed (non-fatal)', err);
        }
      }

      const read = await listPhotosForEntity({
        organizationId: ctx.organizationId,
        entityType: 'SERIAL_UNIT',
        entityId: unit.id,
      });

      return NextResponse.json({
        success: true,
        unit_id: unit.id,
        inserted: insertedIds.length,
        photos: read.map((row) => ({
          id: row.id,
          url: row.url?.startsWith('/api/photos/') ? row.url : photoContentUrl(row.id),
          photoType: row.photoType,
          uploadedBy: row.takenByStaffId,
          createdAt: row.createdAt,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to attach unit photos';
      console.error('POST /api/serial-units/[id]/photos:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'tech.scan_serial' },
);
