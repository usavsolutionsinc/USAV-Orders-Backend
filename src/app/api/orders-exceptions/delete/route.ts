import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders-exceptions/delete - Delete one or more exception rows
 * Body: { exceptionId?: number, exceptionIds?: number[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { exceptionId, exceptionIds } = body;

    if (!exceptionId && (!exceptionIds || !Array.isArray(exceptionIds) || exceptionIds.length === 0)) {
      return NextResponse.json(
        { error: 'exceptionId or exceptionIds array is required' },
        { status: 400 }
      );
    }

    const idsToDelete: number[] = exceptionId ? [exceptionId] : exceptionIds;
    const placeholders = idsToDelete.map((_, idx) => `$${idx + 1}`).join(', ');

    const result = await pool.query(
      `DELETE FROM orders_exceptions WHERE id IN (${placeholders})`,
      idsToDelete
    );

    return NextResponse.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error: any) {
    console.error('Error deleting orders_exceptions row(s):', error);
    return NextResponse.json(
      { error: 'Failed to delete orders_exceptions row(s)', details: error.message },
      { status: 500 }
    );
  }
}

