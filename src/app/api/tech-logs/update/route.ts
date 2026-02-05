import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// PATCH endpoint deprecated - replaced by /api/tech/add-serial which handles duplicate detection and proper serial appending
export async function PATCH(req: NextRequest) {
    return NextResponse.json({ 
        error: 'This endpoint is deprecated. Use /api/tech/add-serial instead.' 
    }, { status: 410 });
}
