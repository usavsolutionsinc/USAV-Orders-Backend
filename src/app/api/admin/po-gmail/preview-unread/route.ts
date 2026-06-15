/**
 * Dry-run preview of unread PO mailbox emails.
 *
 * No DB writes, no labeling — just fetch, parse, and return enough to
 * eyeball whether the order-number extractor is catching real POs.
 * Once the user is happy with the matches, the same pipeline graduates
 * into the cron-triggered reconciler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { listMessageIds, fetchMessagesByIds } from '@/lib/po-gmail/messages';
import { extractOrderNumbers } from '@/lib/po-gmail/extract';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const BODY_PREVIEW_CHARS = 800;

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const query = url.searchParams.get('q') ?? 'is:unread';

    const startedAt = Date.now();
    const { ids } = await listMessageIds(query, limit, undefined, ctx.organizationId);
    const messages = await fetchMessagesByIds(ids, ctx.organizationId);

    const items = messages.map((m) => {
      const extracted = extractOrderNumbers(`${m.subject}\n${m.bodyText}`);
      return {
        id: m.id,
        threadId: m.threadId,
        subject: m.subject,
        from: m.from,
        date: m.date,
        internalDate: m.internalDate,
        snippet: m.snippet,
        hasAttachments: m.hasAttachments,
        bodyPreview: m.bodyText.slice(0, BODY_PREVIEW_CHARS),
        bodyTruncated: m.bodyText.length > BODY_PREVIEW_CHARS,
        bodyLength: m.bodyText.length,
        extracted: {
          all: extracted.all,
          labeled: extracted.labeled,
          unlabeled: extracted.unlabeled,
        },
      };
    });

    return NextResponse.json({
      query,
      limit,
      count: items.length,
      elapsedMs: Date.now() - startedAt,
      items,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/preview-unread');
  }
}, { permission: 'admin.view' });
