import { NextRequest, NextResponse } from 'next/server';
import { getIssuesForFavorite, createIssueTemplate } from '@/lib/neon/repair-issue-queries';
import { withAuth, type AuthContext } from '@/lib/auth/withAuth';
import type { OrgId } from '@/lib/tenancy/constants';

function isMissingRelationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '42P01'
  );
}

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    const { searchParams } = new URL(req.url);
    const rawFavId = searchParams.get('favoriteSkuId');
    const favoriteSkuId = rawFavId ? Number(rawFavId) : null;

    if (rawFavId && (!Number.isFinite(favoriteSkuId) || favoriteSkuId! <= 0)) {
      return NextResponse.json({ error: 'Invalid favoriteSkuId' }, { status: 400 });
    }

    const issues = await getIssuesForFavorite(favoriteSkuId, ctx.organizationId as OrgId);
    return NextResponse.json({ issues, count: issues.length });
  } catch (error: unknown) {
    if (isMissingRelationError(error)) {
      // DB not migrated yet — ReasonSelector falls back to built-in defaults.
      return NextResponse.json({ issues: [], count: 0 });
    }
    console.error('GET /api/repair/issues error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch issues', details: message },
      { status: 500 },
    );
  }
}, { permission: 'repair.view' });

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
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
    }, ctx.organizationId as OrgId);

    return NextResponse.json({ success: true, issue });
  } catch (error: any) {
    console.error('POST /api/repair/issues error:', error);
    return NextResponse.json(
      { error: 'Failed to create issue template', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'repair.intake' });
