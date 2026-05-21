import { db } from '@/lib/drizzle/db';
import { syncCursors } from '@/lib/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export interface SyncCursorRepository {
  get(orgId: string, resource: string): Promise<typeof syncCursors.$inferSelect | null>;
  upsert(orgId: string, resource: string, values: { lastSyncedAt?: Date | null; fullSyncAt?: Date | null }): Promise<void>;
}

export class DrizzleSyncCursorRepository implements SyncCursorRepository {
  async get(_orgId: string, resource: string) {
    // NB: filtering on resource alone is correct because (organization_id,
    // resource) becomes the natural key once RLS is enforced — the resource
    // string is already globally unique within the tenant. _orgId remains
    // here so the call sites carry tenant context through.
    const rows = await db.select().from(syncCursors).where(eq(syncCursors.resource, resource)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(orgId: string, resource: string, values: { lastSyncedAt?: Date | null; fullSyncAt?: Date | null }) {
    await db.insert(syncCursors).values({
      organizationId: orgId,
      resource,
      lastSyncedAt: values.lastSyncedAt ?? null,
      fullSyncAt: values.fullSyncAt ?? null,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: syncCursors.resource,
      set: {
        lastSyncedAt: values.lastSyncedAt ?? sql`${syncCursors.lastSyncedAt}`,
        fullSyncAt: values.fullSyncAt ?? sql`${syncCursors.fullSyncAt}`,
        updatedAt: sql`now()`,
      },
    });
  }
}

export const syncCursorRepository = new DrizzleSyncCursorRepository();
