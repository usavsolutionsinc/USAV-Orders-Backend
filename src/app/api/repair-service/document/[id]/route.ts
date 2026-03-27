import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/repair-service/document/[id] — Retrieve signed document for a repair
 * The id param is the repair_service.id, not the document.id
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repairId = parseInt(id);

    if (isNaN(repairId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         d.id,
         d.entity_type,
         d.entity_id,
         d.document_type,
         d.signature_url,
         d.signer_name,
         d.signed_at,
         d.document_data,
         d.created_at
       FROM documents d
       WHERE d.entity_type = 'REPAIR' AND d.entity_id = $1
       ORDER BY d.created_at DESC
       LIMIT 10`,
      [repairId],
    );

    return NextResponse.json({
      repairId,
      documents: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching repair documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents', details: error.message },
      { status: 500 },
    );
  }
}
