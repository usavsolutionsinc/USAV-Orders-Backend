import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  claimSellerMessagePayload,
  deleteClaimSellerMessage,
  getClaimSellerMessage,
  getClaimSellerMessageById,
  upsertClaimSellerMessage,
} from '@/lib/receiving-claim-seller-message';

export const dynamic = 'force-dynamic';

const QueryByEntity = z.object({
  receivingId: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive().optional(),
});

const QueryById = z.object({
  id: z.coerce.number().int().positive(),
});

const PatchBody = z.object({
  receivingId: z.number().int().positive(),
  lineId: z.number().int().positive().nullable().optional(),
  sellerMessage: z.string().min(1),
  subjectSnapshot: z.string().optional(),
});

/**
 * GET    ?receivingId=&lineId?  → draft for a carton/line
 * GET    ?id=                     → draft by receiving_claim_seller_messages.id
 * PATCH  { receivingId, lineId?, sellerMessage } → update draft (links stripped)
 * DELETE ?receivingId=&lineId?  → remove draft for entity (unlink / ticket change)
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const context = 'GET /api/receiving/zendesk-claim/seller-message';
  try {
    const idParam = req.nextUrl.searchParams.get('id');
    if (idParam) {
      const { id } = QueryById.parse({ id: idParam });
      const row = await getClaimSellerMessageById({ orgId: ctx.organizationId, id });
      return NextResponse.json({
        success: true,
        message: row ? claimSellerMessagePayload(row) : null,
      });
    }

    const q = QueryByEntity.parse({
      receivingId: req.nextUrl.searchParams.get('receivingId') ?? undefined,
      lineId: req.nextUrl.searchParams.get('lineId') ?? undefined,
    });

    const row = await getClaimSellerMessage({
      orgId: ctx.organizationId,
      receivingId: q.receivingId,
      lineId: q.lineId ?? null,
    });

    return NextResponse.json({
      success: true,
      message: row ? claimSellerMessagePayload(row) : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(err.message), context);
    }
    if (err instanceof Error && err.message === 'Receiving not found') {
      return errorResponse(ApiError.notFound('Receiving', ''), context);
    }
    if (err instanceof Error && err.message === 'Receiving line not found') {
      return errorResponse(ApiError.notFound('Receiving line', ''), context);
    }
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const context = 'PATCH /api/receiving/zendesk-claim/seller-message';
  try {
    const body = PatchBody.parse(await req.json().catch(() => ({})));

    const row = await upsertClaimSellerMessage({
      orgId: ctx.organizationId,
      receivingId: body.receivingId,
      lineId: body.lineId ?? null,
      sellerMessage: body.sellerMessage,
      subjectSnapshot: body.subjectSnapshot ?? null,
      staffId: ctx.staffId ?? null,
    });

    return NextResponse.json({
      success: true,
      message: claimSellerMessagePayload(row),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(err.message), context);
    }
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const context = 'DELETE /api/receiving/zendesk-claim/seller-message';
  try {
    const q = QueryByEntity.parse({
      receivingId: req.nextUrl.searchParams.get('receivingId') ?? undefined,
      lineId: req.nextUrl.searchParams.get('lineId') ?? undefined,
    });

    const removed = await deleteClaimSellerMessage({
      orgId: ctx.organizationId,
      receivingId: q.receivingId,
      lineId: q.lineId ?? null,
    });

    return NextResponse.json({ success: true, removed });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(err.message), context);
    }
    if (err instanceof Error && err.message === 'Receiving not found') {
      return errorResponse(ApiError.notFound('Receiving', ''), context);
    }
    if (err instanceof Error && err.message === 'Receiving line not found') {
      return errorResponse(ApiError.notFound('Receiving line', ''), context);
    }
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });
