/**
 * POST /api/receiving/identify-label
 *
 * Resolve Bose model string(s) read off a product label by the LAN vision box
 * (/identify-label OCR) to real catalog products, so the receiving UI can show
 * "Bose Wave Music System AWRCC1 — confirm?" and then add the line by its resolved
 * sku_catalog_id. The browser posts the captured label frame straight to the box
 * (full-res never reaches Vercel) and forwards the resulting model(s) here.
 *
 * Read-only: this only looks up Zoho items + catalog rows. The actual pairing reuses
 * the existing idempotent /api/receiving/add-unmatched-line — no mutation here.
 *
 * Body: { model: string }  or  { models: string[] }
 * Resp: { success, candidates: LabelMatch[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { resolveModels } from '@/lib/receiving/label-identify';

export const POST = withAuth(
  async (request: NextRequest) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
    }

    const models: string[] = Array.isArray(body.models)
      ? (body.models as unknown[]).map((m) => String(m ?? '')).filter(Boolean)
      : typeof body.model === 'string' && body.model.trim()
        ? [body.model.trim()]
        : [];

    if (models.length === 0) {
      return NextResponse.json(
        { success: false, error: 'model (string) or models (string[]) is required' },
        { status: 400 },
      );
    }

    const candidates = await resolveModels(models);
    return NextResponse.json({ success: true, candidates });
  },
  { permission: 'receiving.view' },
);
