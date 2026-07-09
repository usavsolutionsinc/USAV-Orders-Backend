import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { handleReceivingLinesGet } from '@/app/api/receiving-lines/route';

/**
 * GET /api/testing/receiving-lines
 *
 * Testing-only feed for the QC / package-pairing station. Wraps the shared
 * receiving-lines query but restricts `view=` to `testing` | `needs-test` and
 * requires the tech QC permission — so Unbox/Receiving operators cannot
 * accidentally pull testing-queue data from the receiving endpoint (and vice
 * versa).
 */
export const GET = withAuth(
  (request: NextRequest, ctx) => handleReceivingLinesGet(request, ctx, 'testing'),
  { permission: 'tech.qc_pass' },
);
