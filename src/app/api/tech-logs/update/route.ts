import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

// PATCH endpoint deprecated - replaced by /api/tech/add-serial which handles duplicate detection and proper serial appending.
// Still gate it so unauthenticated abuse can't produce noise in the logs.
async function handlePatch(_req: NextRequest) {
    return NextResponse.json({
        error: 'This endpoint is deprecated. Use /api/tech/add-serial instead.',
    }, { status: 410 });
}

export const PATCH = withAuth(handlePatch, { permission: 'tech.view' });
