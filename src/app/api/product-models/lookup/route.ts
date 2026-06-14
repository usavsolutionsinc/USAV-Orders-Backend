import { NextRequest, NextResponse } from 'next/server';
import { lookupCompatibility } from '@/lib/neon/bose-model-queries';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/product-models/lookup?serial=… | ?model=…
 *
 * Brand-neutral façade for the compatibility lookup (Sourcing Hub plan §5,
 * Option A). Resolves a product model from a serial number (longest-prefix
 * decode) or a model string (exact model_number, else name search) and returns
 * its compatible parts joined to live stock, lifecycle and open sourcing alerts.
 *
 * Today it reads the same underlying model/compatibility tables as the legacy
 * /api/bose-models/lookup (shared `lookupCompatibility` query) — this route is
 * the seam we grow as the catalog generalizes beyond one brand. The response
 * shape (`{ resolvedBy, model: { model_number, model_name, family }, parts }`)
 * is already brand-neutral. Degrades gracefully: an unresolved input returns 200
 * with { model: null, parts: [] } so the UI can show an empty state.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const serial = searchParams.get('serial');
    const model = searchParams.get('model');

    if (!serial?.trim() && !model?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Provide a serial or model query parameter' },
        { status: 400 },
      );
    }

    const result = await lookupCompatibility({ serial, model });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error in GET /api/product-models/lookup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lookup failed' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });
