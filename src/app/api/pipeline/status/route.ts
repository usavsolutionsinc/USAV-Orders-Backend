/**
 * GET /api/pipeline/status
 *
 * Returns current pipeline health: recent cycles, training runs,
 * sample counts, and active model version.
 */

import { db } from '@/lib/drizzle/db';
import {
  pipelineCycles,
  trainingSamples,
  trainingRuns,
  modelVersions,
  pipelineTasks,
} from '@/lib/drizzle/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // Recent cycles (last 10)
    const recentCycles = await db
      .select()
      .from(pipelineCycles)
      .orderBy(desc(pipelineCycles.startedAt))
      .limit(10);

    // Sample counts by status
    const sampleCounts = await db
      .select({
        status: trainingSamples.status,
        count: count(),
      })
      .from(trainingSamples)
      .groupBy(trainingSamples.status);

    // Task counts by status
    const taskCounts = await db
      .select({
        status: pipelineTasks.status,
        count: count(),
      })
      .from(pipelineTasks)
      .groupBy(pipelineTasks.status);

    // Latest training run
    const latestRun = await db
      .select()
      .from(trainingRuns)
      .orderBy(desc(trainingRuns.createdAt))
      .limit(1);

    // Active model version
    const activeModel = await db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.promoted, true))
      .limit(1);

    // Total samples and average rating
    const stats = await db
      .select({
        totalSamples: count(),
        avgRating: sql<number>`ROUND(AVG(${trainingSamples.rating}), 2)`,
      })
      .from(trainingSamples)
      .where(sql`${trainingSamples.rating} IS NOT NULL`);

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
