import { randomBytes } from 'node:crypto';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { photoContentUrl } from './display-url';
import { createPhotoEntityLink } from './links';
import pool from '@/lib/db';

export interface CreateSharePackInput {
  organizationId: string;
  staffId: number;
  photoIds: number[];
  title: string;
  packType?: 'manual' | 'claim' | 'customer';
  poRef?: string | null;
  receivingId?: number | null;
  zendeskTicketId?: number | null;
  expiresInDays?: number;
  filenamePrefix?: string;
}

export interface SharePackResult {
  packId: number;
  publicToken: string;
  shareUrl: string;
  expiresAt: string | null;
}

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

async function insertSharePackLinks(
  client: { query: typeof pool.query },
  input: {
    packId: number;
    organizationId: string;
    poRef?: string | null;
    receivingId?: number | null;
    zendeskTicketId?: number | null;
  },
): Promise<void> {
  try {
    if (input.receivingId != null) {
      await client.query(
        `INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
         VALUES ($1, $2, 'receiving_id', $3)
         ON CONFLICT DO NOTHING`,
        [input.packId, input.organizationId, String(input.receivingId)],
      );
    }
    if (input.poRef?.trim()) {
      await client.query(
        `INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
         VALUES ($1, $2, 'po_ref', $3)
         ON CONFLICT DO NOTHING`,
        [input.packId, input.organizationId, input.poRef.trim()],
      );
    }
    if (input.zendeskTicketId != null) {
      await client.query(
        `INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
         VALUES ($1, $2, 'zendesk_ticket_id', $3)
         ON CONFLICT DO NOTHING`,
        [input.packId, input.organizationId, String(input.zendeskTicketId)],
      );
    }
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
}

async function insertSharePackAccess(
  client: { query: typeof pool.query },
  input: {
    packId: number;
    organizationId: string;
    publicToken: string;
    expiresAt: string | null;
  },
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO photo_share_pack_access
         (pack_id, organization_id, public_token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.packId, input.organizationId, input.publicToken, input.expiresAt],
    );
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
}

export async function createSharePack(
  input: CreateSharePackInput,
  appOrigin: string,
): Promise<SharePackResult> {
  const uniqueIds = [...new Set(input.photoIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) throw new Error('At least one photo id is required');

  const verify = await pool.query(
    `SELECT id FROM photos WHERE organization_id = $1 AND id = ANY($2::bigint[])`,
    [input.organizationId, uniqueIds],
  );
  if (verify.rowCount !== uniqueIds.length) {
    throw new Error('One or more photos not found in organization');
  }

  const defaultTtlDays = Number(process.env.PHOTOS_SHARE_DEFAULT_TTL_DAYS || 30);
  const ttlDays = input.expiresInDays ?? defaultTtlDays;
  const expiresAt =
    ttlDays > 0
      ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const publicToken = generateToken();
  const prefix = (input.filenamePrefix || 'Photo').replace(/[^\w.-]+/g, '_');

  return withTenantTransaction(input.organizationId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO photo_share_packs
         (organization_id, public_token, title, pack_type, po_ref, receiving_id,
          zendesk_ticket_id, created_by_staff_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.organizationId,
        publicToken,
        input.title,
        input.packType ?? 'manual',
        input.poRef ?? null,
        input.receivingId ?? null,
        input.zendeskTicketId ?? null,
        input.staffId,
        expiresAt,
      ],
    );
    const packId = Number(rows[0].id);

    await insertSharePackAccess(client, {
      packId,
      organizationId: input.organizationId,
      publicToken,
      expiresAt,
    });

    await insertSharePackLinks(client, {
      packId,
      organizationId: input.organizationId,
      poRef: input.poRef,
      receivingId: input.receivingId,
      zendeskTicketId: input.zendeskTicketId,
    });

    for (let i = 0; i < uniqueIds.length; i++) {
      const photoId = uniqueIds[i];
      const exportFilename = `${prefix}_${String(i + 1).padStart(2, '0')}.jpg`;
      await client.query(
        `INSERT INTO photo_share_pack_items (pack_id, photo_id, sort_order, export_filename)
         VALUES ($1, $2, $3, $4)`,
        [packId, photoId, i, exportFilename],
      );
      await createPhotoEntityLink(client, {
        photoId,
        organizationId: input.organizationId,
        entityType: 'SHARE_PACK',
        entityId: packId,
        linkRole: 'insurance_share',
      });
    }

    const shareUrl = `${appOrigin.replace(/\/+$/, '')}/share/photos/${publicToken}`;
    return { packId, publicToken, shareUrl, expiresAt };
  });
}

interface ResolvedSharePackRow {
  pack_id: string;
  organization_id: string;
  title: string;
  pack_type: string;
  po_ref: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

async function resolveSharePackRow(publicToken: string): Promise<ResolvedSharePackRow | null> {
  try {
    const viaAccess = await pool.query<ResolvedSharePackRow>(
      `SELECT p.id AS pack_id, p.organization_id, p.title, p.pack_type, p.po_ref,
              COALESCE(a.expires_at, p.expires_at) AS expires_at,
              p.created_at, a.revoked_at
         FROM photo_share_pack_access a
         JOIN photo_share_packs p ON p.id = a.pack_id
        WHERE a.public_token = $1
        LIMIT 1`,
      [publicToken],
    );
    if (viaAccess.rows[0]) return viaAccess.rows[0];
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== '42P01') throw err;
  }

  const legacy = await pool.query<ResolvedSharePackRow>(
    `SELECT id AS pack_id, organization_id, title, pack_type, po_ref,
            expires_at, created_at, NULL::timestamptz AS revoked_at
       FROM photo_share_packs
      WHERE public_token = $1
      LIMIT 1`,
    [publicToken],
  );
  return legacy.rows[0] ?? null;
}

export async function getSharePackByToken(publicToken: string) {
  const pack = await resolveSharePackRow(publicToken);
  if (!pack) return null;

  if (pack.revoked_at) {
    return { expired: true as const, pack: null, photos: [] };
  }

  if (pack.expires_at && new Date(pack.expires_at).getTime() < Date.now()) {
    return { expired: true as const, pack: null, photos: [] };
  }

  const itemsRes = await pool.query<{
    photo_id: string;
    export_filename: string | null;
    sort_order: number;
  }>(
    `SELECT i.photo_id, i.export_filename, i.sort_order
       FROM photo_share_pack_items i
       JOIN photos p ON p.id = i.photo_id
      WHERE i.pack_id = $1
      ORDER BY i.sort_order ASC, i.id ASC`,
    [pack.pack_id],
  );

  return {
    expired: false as const,
    organizationId: pack.organization_id,
    pack: {
      id: Number(pack.pack_id),
      title: pack.title,
      packType: pack.pack_type,
      poRef: pack.po_ref,
      createdAt: pack.created_at,
      expiresAt: pack.expires_at,
    },
    photos: itemsRes.rows.map((r) => ({
      id: Number(r.photo_id),
      exportFilename: r.export_filename,
      sortOrder: r.sort_order,
      url: photoContentUrl(Number(r.photo_id)),
    })),
  };
}

export async function resolveSharePackOrganizationId(publicToken: string): Promise<string | null> {
  const row = await resolveSharePackRow(publicToken);
  return row?.organization_id ?? null;
}
