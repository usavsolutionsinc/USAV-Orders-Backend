import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/ebay/accounts
 * Get all eBay accounts with their status
 */
export async function GET() {
  try {
    const result = await pool.query(
      `SELECT 
        id, 
        account_name, 
        ebay_user_id, 
        token_expires_at, 
        last_sync_date, 
        is_active, 
        created_at,
        marketplace_id
      FROM ebay_accounts 
      ORDER BY account_name`
    );

    return NextResponse.json({ 
      success: true,
      accounts: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error('Error fetching eBay accounts:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/ebay/accounts
 * Update an eBay account (e.g., toggle active status)
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      );
    }

    await pool.query(
      'UPDATE ebay_accounts SET is_active = $1, updated_at = NOW() WHERE id = $2',
      [is_active, id]
    );

    return NextResponse.json({ 
      success: true,
      message: 'Account updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating eBay account:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
