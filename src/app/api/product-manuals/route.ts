import { NextRequest, NextResponse } from 'next/server';
import { getAllProductManuals, upsertProductManual } from '@/lib/neon/product-manuals-queries';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '5000', 10), 10000);
    const manuals = await getAllProductManuals({ limit });
    return NextResponse.json(manuals);
  } catch (error: any) {
    console.error('Error fetching product manuals:', error);
    return NextResponse.json({ error: 'Failed to fetch product manuals', details: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sku, itemNumber, productTitle, googleDocIdOrUrl, type } = body;

    if (!googleDocIdOrUrl) {
      return NextResponse.json({ error: 'googleDocIdOrUrl is required' }, { status: 400 });
    }
    if (!sku && !itemNumber) {
      return NextResponse.json({ error: 'Either sku or itemNumber is required' }, { status: 400 });
    }

    const manual = await upsertProductManual({ sku, itemNumber, productTitle, googleDocIdOrUrl, type });
    return NextResponse.json({ success: true, manual }, { status: 201 });
  } catch (error: any) {
    console.error('Error upserting product manual:', error);
    return NextResponse.json({ error: 'Failed to save product manual', details: error.message }, { status: 500 });
  }
}
