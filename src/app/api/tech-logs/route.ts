import { NextRequest } from 'next/server';
import { GET as unifiedLogs } from '@/app/api/tech/logs/route';

/**
 * Legacy GET /api/tech-logs — thin wrapper around GET /api/tech/logs.
 * Passes through all query params unchanged.
 */
export async function GET(req: NextRequest) {
  return unifiedLogs(req);
}
