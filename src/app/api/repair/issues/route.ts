import { NextRequest, NextResponse } from 'next/server';
import { getIssuesForFavorite, createIssueTemplate } from '@/lib/neon/repair-issue-queries';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawFavId = searchParams.get('favoriteSkuId');
    const favoriteSkuId = rawFavId ? Number(rawFavId) : null;

    if (rawFavId && (!Number.isFinite(favoriteSkuId) || favoriteSkuId! <= 0)) {
      return NextResponse.json({ error: 'Invalid favoriteSkuId' }, { status: 400 });
    }

    const issues = await getIssuesForFavorite(favoriteSkuId);
    return NextResponse.json({ issues, count: issues.length });
  } catch (error: any) {
    console.error('GET /api/repair/issues error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch issues', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const label = String(body?.label || '').trim();

    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 });
    }

    const favoriteSkuId = body?.favoriteSkuId ? Number(body.favoriteSkuId) : null;
    if (favoriteSkuId !== null && (!Number.isFinite(favoriteSkuId) || favoriteSkuId <= 0)) {
      return NextResponse.json({ error: 'Invalid favoriteSkuId' }, { status: 400 });
    }

    const issue = await createIssueTemplate({
      favoriteSkuId,
      label,
      category: body?.category || null,
      sortOrder: body?.sortOrder ?? 0,
    });

    return NextResponse.json({ success: true, issue });
  } catch (error: any) {
    console.error('POST /api/repair/issues error:', error);
    return NextResponse.json(
      { error: 'Failed to create issue template', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
