import { NextRequest, NextResponse } from 'next/server';
import { lookupCompatibility } from '@/lib/neon/bose-model-queries';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/bose-models/lookup?serial=… | ?model=…
 *
 * The compatibility lookup entry point. Resolves a model from a serial number
 * (longest-prefix decode) or a model string (exact model_number, else name
 * search), then returns its compatible parts joined to live stock, lifecycle
 * status and open sourcing alerts. Degrades gracefully: an unresolved input
 * returns 200 with { model: null, parts: [] } rather than a 404, so the UI can
 * show an empty state instead of an error.
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
    console.error('Error in GET /api/bose-models/lookup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lookup failed' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });
