/**
 * POST /api/pipeline/trigger
 *
 * Manually trigger a single pipeline discovery cycle.
 * Useful for testing or after deploying new code.
 *
 * This is a lightweight endpoint — it runs discovery only (no implementation)
 * and returns the discovered tasks. The orchestrator handles implementation.
 */

import { NextResponse } from 'next/server';
import { discoverTasks } from '@/lib/pipeline/discover';
import { REPO_PATH } from '@/lib/pipeline/config';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const tasks = await discoverTasks(REPO_PATH);

    return NextResponse.json({
      ok: true,
      tasksDiscovered: tasks.length,
      tasks: tasks.map((t) => ({
        hash: t.hash,
        title: t.title,
        source: t.source,
        priority: t.priority,
        filePaths: t.filePaths,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
