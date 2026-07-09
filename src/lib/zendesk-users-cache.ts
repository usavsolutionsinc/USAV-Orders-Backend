/**
 * DB cache of Zendesk users (id → name/email/photo) so the support thread can
 * resolve comment authors WITHOUT pinging the Zendesk API on every render — the
 * cause of the "User #2526 → email" flicker.
 *
 * The comments route reads this (plus the in-proc agent roster) to attach author
 * identity server-side on first paint, and backfills misses in the background.
 * Org-scoped via tenantQuery / withTenantTransaction (organization_id auto-stamps
 * from the app.current_org GUC — see the migration).
 */

import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { ZendeskUser } from '@/lib/zendesk';

export interface CachedZendeskUser {
  id: number;
  name: string;
  email: string | null;
  photo: string | null;
  role: string | null;
}

/** Cached identities for the given ids, keyed by Zendesk user id. Misses are absent. */
export async function getCachedUsers(
  organizationId: OrgId,
  ids: number[],
): Promise<Map<number, CachedZendeskUser>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  const out = new Map<number, CachedZendeskUser>();
  if (!unique.length) return out;

  const r = await tenantQuery<{
    zendesk_user_id: string | number;
    name: string | null;
    email: string | null;
    photo_url: string | null;
    role: string | null;
  }>(
    organizationId,
    `SELECT zendesk_user_id, name, email, photo_url, role
       FROM zendesk_users
      WHERE organization_id = $1
        AND zendesk_user_id = ANY($2::bigint[])`,
    [organizationId, unique],
  );
  for (const row of r.rows) {
    const id = Number(row.zendesk_user_id);
    out.set(id, {
      id,
      name: row.name ?? `User #${id}`,
      email: row.email,
      photo: row.photo_url,
      role: row.role,
    });
  }
  return out;
}

/** Upsert a batch of resolved Zendesk users, refreshing synced_at. */
export async function upsertCachedUsers(
  organizationId: OrgId,
  users: ZendeskUser[],
): Promise<void> {
  const rows = users.filter((u) => Number.isInteger(u.id) && u.id > 0);
  if (!rows.length) return;
  await withTenantTransaction(organizationId, async (client) => {
    for (const u of rows) {
      await client.query(
        `INSERT INTO zendesk_users (organization_id, zendesk_user_id, name, email, photo_url, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, zendesk_user_id)
         DO UPDATE SET name = EXCLUDED.name,
                       email = EXCLUDED.email,
                       photo_url = EXCLUDED.photo_url,
                       role = EXCLUDED.role,
                       synced_at = NOW()`,
        [organizationId, u.id, u.name, u.email, u.photo, u.role],
      );
    }
  });
}
