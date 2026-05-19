import pool from '@/lib/db';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1';
const UPLOAD_URL = `${PHOTOS_API}/uploads`;
const BATCH_CREATE_URL = `${PHOTOS_API}/mediaItems:batchCreate`;
const ALBUMS_URL = `${PHOTOS_API}/albums`;

export const GOOGLE_PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photoslibrary.appendonly';

export interface MediaItemResult {
  id: string;
  productUrl: string;
  filename: string;
  mimeType: string;
}

export interface AlbumResult {
  id: string;
  title: string;
  productUrl?: string;
}

interface TokenRow {
  id: number;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
  account_email: string | null;
}

async function loadActiveToken(): Promise<TokenRow> {
  const { rows } = await pool.query<TokenRow>(
    `SELECT id, refresh_token, access_token, expires_at, account_email
     FROM google_oauth_tokens
     WHERE provider = 'google_photos'
     LIMIT 1`,
  );
  if (!rows[0]) {
    throw new Error('Google Photos is not connected. Visit the admin Photo Backup tab to connect.');
  }
  return rows[0];
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.GOOGLE_PHOTOS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_PHOTOS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET are not set');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000),
  };
}

export async function getAccessToken(): Promise<string> {
  const row = await loadActiveToken();
  const now = Date.now();
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > now + 30_000) {
    return row.access_token;
  }
  const { accessToken, expiresAt } = await refreshAccessToken(row.refresh_token);
  await pool.query(
    `UPDATE google_oauth_tokens
       SET access_token = $1, expires_at = $2
     WHERE id = $3`,
    [accessToken, expiresAt.toISOString(), row.id],
  );
  return accessToken;
}

async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function uploadBytes(buffer: Buffer, filename: string, mimeType = 'image/jpeg'): Promise<string> {
  const res = await authedFetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mimeType,
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': filename,
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Photos upload failed (${res.status}): ${text}`);
  }
  return (await res.text()).trim();
}

export async function createMediaItem(params: {
  uploadToken: string;
  filename: string;
  description?: string;
  albumId?: string;
}): Promise<MediaItemResult> {
  const body = {
    albumId: params.albumId,
    newMediaItems: [
      {
        description: params.description ?? '',
        simpleMediaItem: {
          fileName: params.filename,
          uploadToken: params.uploadToken,
        },
      },
    ],
  };
  const res = await authedFetch(BATCH_CREATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Photos batchCreate failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    newMediaItemResults?: Array<{
      status?: { message?: string; code?: number };
      mediaItem?: {
        id: string;
        productUrl: string;
        filename: string;
        mimeType: string;
      };
    }>;
  };
  const result = json.newMediaItemResults?.[0];
  if (!result?.mediaItem) {
    const msg = result?.status?.message || 'Unknown error';
    throw new Error(`Google Photos did not return a mediaItem: ${msg}`);
  }
  return {
    id: result.mediaItem.id,
    productUrl: result.mediaItem.productUrl,
    filename: result.mediaItem.filename,
    mimeType: result.mediaItem.mimeType,
  };
}

export async function getOrCreateAlbum(albumKey: string, title: string): Promise<AlbumResult> {
  const existing = await pool.query<{ google_album_id: string; title: string; product_url: string | null }>(
    `SELECT google_album_id, title, product_url
     FROM google_photos_albums
     WHERE album_key = $1`,
    [albumKey],
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].google_album_id,
      title: existing.rows[0].title,
      productUrl: existing.rows[0].product_url ?? undefined,
    };
  }

  const res = await authedFetch(ALBUMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ album: { title } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Photos album create failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { id: string; title: string; productUrl?: string };

  await pool.query(
    `INSERT INTO google_photos_albums (album_key, google_album_id, title, product_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (album_key) DO UPDATE
       SET google_album_id = EXCLUDED.google_album_id,
           title = EXCLUDED.title,
           product_url = EXCLUDED.product_url`,
    [albumKey, json.id, json.title, json.productUrl ?? null],
  );

  return { id: json.id, title: json.title, productUrl: json.productUrl };
}

export async function uploadAndAttach(params: {
  buffer: Buffer;
  filename: string;
  description?: string;
  albumId?: string;
  mimeType?: string;
}): Promise<MediaItemResult> {
  const uploadToken = await uploadBytes(params.buffer, params.filename, params.mimeType);
  return createMediaItem({
    uploadToken,
    filename: params.filename,
    description: params.description,
    albumId: params.albumId,
  });
}
