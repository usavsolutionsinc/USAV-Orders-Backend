/**
 * GET /api/pipeline/status
 *
 * Returns current pipeline health: recent cycles, training runs,
 * sample counts, and active model version.
 */

import {
  pipelineCycles,
  trainingSamples,
  trainingRuns,
  modelVersions,
  pipelineTasks,
} from '@/lib/drizzle/schema';
import { and, desc, eq, sql, count } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import type { OrgId } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  const orgId: OrgId = ctx.organizationId;
  try {
    return await withTenantDrizzle(orgId, async (tx) => {
    // Recent cycles (last 10)
    const recentCycles = await tx
      .select()
      .from(pipelineCycles)
      .where(eq(pipelineCycles.organizationId, orgId))
      .orderBy(desc(pipelineCycles.startedAt))
      .limit(10);

    // Sample counts by status
    const sampleCounts = await tx
      .select({
        status: trainingSamples.status,
        count: count(),
      })
      .from(trainingSamples)
      .where(eq(trainingSamples.organizationId, orgId))
      .groupBy(trainingSamples.status);

    // Task counts by status
    const taskCounts = await tx
      .select({
        status: pipelineTasks.status,
        count: count(),
      })
      .from(pipelineTasks)
      .where(eq(pipelineTasks.organizationId, orgId))
      .groupBy(pipelineTasks.status);

    // Latest training run
    const latestRun = await tx
      .select()
      .from(trainingRuns)
      .where(eq(trainingRuns.organizationId, orgId))
      .orderBy(desc(trainingRuns.createdAt))
      .limit(1);

    // Active model version
    const activeModel = await tx
      .select()
      .from(modelVersions)
      .where(and(eq(modelVersions.organizationId, orgId), eq(modelVersions.promoted, true)))
      .limit(1);

    // Total samples and average rating
    const stats = await tx
      .select({
        totalSamples: count(),
        avgRating: sql<number>`ROUND(AVG(${trainingSamples.rating}), 2)`,
      })
      .from(trainingSamples)
      .where(and(eq(trainingSamples.organizationId, orgId), sql`${trainingSamples.rating} IS NOT NULL`));

    return NextResponse.json({
      ok: true,
      pipeline: {
        recentCycles,
        sampleCounts: Object.fromEntries(sampleCounts.map((r) => [r.status, r.count])),
        taskCounts: Object.fromEntries(taskCounts.map((r) => [r.status, r.count])),
        totalRatedSamples: stats[0]?.totalSamples ?? 0,
        averageRating: stats[0]?.avgRating ?? null,
      },
      training: {
        latestRun: latestRun[0] ?? null,
        activeModel: activeModel[0] ?? null,
      },
      timestamp: new Date().toISOString(),
    });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'admin.view' });
