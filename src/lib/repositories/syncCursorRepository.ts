import { db } from '@/lib/drizzle/db';
import { syncCursors } from '@/lib/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export interface SyncCursorRepository {
  get(resource: string): Promise<typeof syncCursors.$inferSelect | null>;
  upsert(resource: string, values: { lastSyncedAt?: Date | null; fullSyncAt?: Date | null }): Promise<void>;
}

export class DrizzleSyncCursorRepository implements SyncCursorRepository {
  async get(resource: string) {
    const rows = await db.select().from(syncCursors).where(eq(syncCursors.resource, resource)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(resource: string, values: { lastSyncedAt?: Date | null; fullSyncAt?: Date | null }) {
    await db.insert(syncCursors).values({
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
