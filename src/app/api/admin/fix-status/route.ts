import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/admin/fix-status - One-time fix for 'uassigned' typo in orders table
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const result = await withTenantTransaction(ctx.organizationId, (client) => client.query(`
      UPDATE orders
      SET status = 'unassigned'
      WHERE status = 'uassigned'
        AND organization_id = $1
      RETURNING id
    `, [ctx.organizationId]));

    return NextResponse.json({ 
      success: true, 
      message: `Fixed ${result.rowCount} records in orders table.`,
      updatedIds: result.rows.map(r => r.id)
    });
  } catch (error: any) {
    console.error('Error fixing status typo:', error);
    return NextResponse.json(
      { error: 'Failed to fix status typo', details: error.message },
      { status: 500 }
    );
  }
}, { permission: 'admin.manage_features' });
