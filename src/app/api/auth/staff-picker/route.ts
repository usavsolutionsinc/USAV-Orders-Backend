/**
 * GET /api/auth/staff-picker
 *
 * Slim list for the sign-in screen — only staff with status='active', sorted
 * by name, with just enough fields to render the grid. Returns `hasPin` so
 * the UI can disable the PIN button for staff that haven't enrolled yet.
 *
 * Public: the picker has to render before sign-in. We expose only id/name/
 * role/hasPin — no email, employee_code, or sensitive columns.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

interface Row {
  id: number;
  name: string;
  role: string;
  has_pin: boolean;
  color_hex: string;
}

export async function GET() {
  try {
    const r = await pool.query(
      `SELECT id, name, role, color_hex, (pin_hash IS NOT NULL) AS has_pin
         FROM staff
        WHERE COALESCE(status, 'active') IN ('active', 'invited')
          AND COALESCE(active, true) = true
        ORDER BY name ASC`,
    );
    return NextResponse.json(
      { staff: r.rows as Row[] },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/auth/staff-picker] error:', err);
    return NextResponse.json({ staff: [] }, { status: 200 });
  }
}
