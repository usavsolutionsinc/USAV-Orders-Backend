import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';

const SOURCE_PLATFORMS = new Set(['zoho', 'ebay', 'amazon', 'aliexpress', 'walmart', 'other']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(body, 'source_platform')) {
      const raw = body.source_platform;
      const next = raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
      if (next != null && !SOURCE_PLATFORMS.has(next)) {
        return NextResponse.json(
          { success: false, error: `Invalid source_platform. Allowed: ${Array.from(SOURCE_PLATFORMS).join(', ')}` },
          { status: 400 },
        );
      }
      updates.push(`source_platform = $${idx++}`);
      values.push(next);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<{ id: number; source_platform: string | null }>(
      `UPDATE receiving SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, source_platform`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      action: 'update',
      rowId: String(id),
      source: 'receiving.patch',
    });

    return NextResponse.json({ success: true, receiving: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update receiving';
    console.error('receiving/[id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
