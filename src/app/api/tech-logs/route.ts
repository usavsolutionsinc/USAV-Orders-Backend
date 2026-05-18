import { NextRequest } from 'next/server';
import { GET as unifiedLogs } from '@/app/api/tech/logs/route';

/**
 * Legacy GET /api/tech-logs — thin wrapper around GET /api/tech/logs.
 * Passes through all query params unchanged. The underlying wrapped handler
 * enforces `tech.view` permission via its own withAuth wrapping.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string | string[] | undefined>> },
) {
  return unifiedLogs(req, ctx);
}
