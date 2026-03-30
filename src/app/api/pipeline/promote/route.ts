/**
 * POST /api/pipeline/promote
 *
 * Auto-promote the latest completed training run if it improved on the
 * current model. Called by the Jetson after training, or manually.
 *
 * Promotion logic:
 *   - If no model is currently promoted → promote unconditionally
 *   - If a model is promoted → only promote if new loss < current loss
 *
 * After promotion, the caller should reload the MLX server with the
 * new adapter (e.g. via the Crush Code router or manually).
 */

import { db } from '@/lib/drizzle/db';
import { trainingRuns, modelVersions } from '@/lib/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  try {
    // Get latest completed training run
    const latestRun = await db
      .select()
      .from(trainingRuns)
      .where(eq(trainingRuns.status, 'completed'))
      .orderBy(desc(trainingRuns.completedAt))
      .limit(1);

    if (!latestRun[0]) {
      return NextResponse.json({
        ok: true,
        promoted: false,
        reason: 'No completed training runs found',
      });
    }

    const run = latestRun[0];

    // Get currently promoted model
    const currentModel = await db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.promoted, true))
      .limit(1);

    const current = currentModel[0];

    // Check if this run already has a version registered
    const existingVersion = await db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.runId, run.id))
      .limit(1);

    // Decision: promote if no current model, or if new loss is lower
    const currentLoss = current?.evalScore ? parseFloat(current.evalScore) : Infinity;
    const newLoss = run.trainLoss ? parseFloat(run.trainLoss) : Infinity;

    if (current && newLoss >= currentLoss) {
      return NextResponse.json({
        ok: true,
        promoted: false,
        reason: `New loss (${newLoss.toFixed(4)}) >= current (${currentLoss.toFixed(4)})`,
        currentVersion: current.version,
      });
    }

    // Demote current model
    if (current) {
      await db.update(modelVersions)
        .set({ promoted: false })
        .where(eq(modelVersions.id, current.id));
    }

    // Promote new version (create if needed, or update existing)
    if (existingVersion[0]) {
      await db.update(modelVersions)
        .set({
          promoted: true,
          promotedAt: new Date(),
          evalScore: run.trainLoss,
        })
        .where(eq(modelVersions.id, existingVersion[0].id));

      return NextResponse.json({
        ok: true,
        promoted: true,
        version: existingVersion[0].version,
        previousVersion: current?.version ?? null,
        adapterPath: existingVersion[0].adapterPath,
        reason: current
          ? `Improved: ${newLoss.toFixed(4)} < ${currentLoss.toFixed(4)}`
          : 'First model promoted',
      });
    }

    // Create new version entry
    const versionNum = current
      ? parseInt(current.version.replace('v', ''), 10) + 1
      : 1;
    const version = `v${versionNum}`;

    await db.insert(modelVersions).values({
      runId: run.id,
      version,
      baseModel: run.baseModel,
      adapterPath: run.adapterPath || '',
      evalScore: run.trainLoss,
      promoted: true,
      promotedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      promoted: true,
      version,
      previousVersion: current?.version ?? null,
      adapterPath: run.adapterPath,
      reason: current
        ? `Improved: ${newLoss.toFixed(4)} < ${currentLoss.toFixed(4)}`
        : 'First model promoted',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
