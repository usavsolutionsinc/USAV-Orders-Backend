/**
 * PATCH /api/receiving/lines/[id]/condition
 *
 * Inline condition_grade update from the per-line pill row. Used by the
 * UnfoundLineEditPanel — equally valid for Zoho-sourced lines.
 *
 * Scoped narrowly to a single column so the surface stays small and the
 * existing lines/[id]/status (workflow events) endpoint isn't disturbed.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { after } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

const ALLOWED_GRADES = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'] as const;
type Grade = (typeof ALLOWED_GRADES)[number];

function normalizeGrade(raw: unknown): Grade | null {
  if (raw == null) return null;
  const upper = String(raw).trim().toUpperCase().replace(/[\s-]/g, '_');
  return (ALLOWED_GRADES as readonly string[]).includes(upper) ? (upper as Grade) : null;
}

export const PATCH = withAuth(async (request: NextRequest) => {
  const segments = request.nextUrl.pathname.split('/');
  const idIdx = segments.indexOf('lines') + 1;
  const lineId = Number(segments[idIdx]);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json(
      { success: false, error: 'invalid line id' },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const grade = normalizeGrade(body.condition_grade);
  if (!grade) {
    return NextResponse.json(
      {
        success: false,
        error: `condition_grade must be one of: ${ALLOWED_GRADES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const result = await pool.query<{
    id: number;
    receiving_id: number | null;
    condition_grade: Grade;
  }>(
    `UPDATE receiving_lines
        SET condition_grade = $1::condition_grade_enum,
            updated_at = NOW()
      WHERE id = $2
      RETURNING id, receiving_id, condition_grade`,
    [grade, lineId],
  );
  const updated = result.rows[0];
  if (!updated) {
    return NextResponse.json(
      { success: false, error: `line ${lineId} not found` },
      { status: 404 },
    );
  }

  after(async () => {
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
      if (updated.receiving_id != null) {
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(updated.receiving_id),
          source: 'receiving.lines.condition',
        });
      }
    } catch (err) {
      console.warn('lines/condition: cache/realtime update failed', err);
    }
  });

  return NextResponse.json({ success: true, line: updated });
});
