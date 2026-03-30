/**
 * POST /api/pipeline/feedback
 *
 * Submit a human rating for a training sample. This lets you manually
 * upgrade or downgrade sample quality to improve training data.
 *
 * Body: { sampleId: number, rating: number (1-5) }
 */

import { db } from '@/lib/drizzle/db';
import { trainingSamples } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sampleId?: number; rating?: number };

    if (!body.sampleId || typeof body.sampleId !== 'number') {
      return NextResponse.json(
        { ok: false, error: 'sampleId (number) is required' },
        { status: 400 },
      );
    }
    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return NextResponse.json(
        { ok: false, error: 'rating must be 1-5' },
        { status: 400 },
      );
    }

    const [updated] = await db.update(trainingSamples)
      .set({
        rating: body.rating,
        status: body.rating >= 2 ? 'rated' : 'rejected',
        ratedAt: new Date(),
      })
      .where(eq(trainingSamples.id, body.sampleId))
      .returning({ id: trainingSamples.id, rating: trainingSamples.rating });

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: `Sample ${body.sampleId} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      sample: updated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
