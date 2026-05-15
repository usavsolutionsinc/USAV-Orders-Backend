import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export interface ReasonCodeRow {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
  sort_order: number;
}

/**
 * GET /api/reason-codes?direction=out&category=shrinkage
 * Returns active reason codes, optionally filtered. Used by ReasonCodePicker
 * in the mobile bin editor (and any future write surface).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const direction = searchParams.get('direction'); // in | out | either
    const category = searchParams.get('category');

    const clauses: string[] = ['is_active = true'];
    const params: string[] = [];

    // Direction filter — when the caller specifies 'out' we still want
    // 'either'-direction codes available (e.g. CYCLE_COUNT_ADJ).
    if (direction === 'in' || direction === 'out') {
      params.push(direction);
      clauses.push(`(direction = $${params.length} OR direction = 'either')`);
    } else if (direction === 'either') {
      // Pass — no filter.
    }
    if (category) {
      params.push(category);
      clauses.push(`category = $${params.length}`);
    }

    const sql = `
      SELECT id, code, label, category, direction,
             requires_note, requires_photo, sort_order
      FROM reason_codes
      WHERE ${clauses.join(' AND ')}
      ORDER BY sort_order ASC, label ASC
    `;
    const result = await pool.query<ReasonCodeRow>(sql, params);
    return NextResponse.json({ success: true, reason_codes: result.rows });
  } catch (err: any) {
    console.error('[GET /api/reason-codes] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load reason codes', details: err?.message },
      { status: 500 },
    );
  }
}
