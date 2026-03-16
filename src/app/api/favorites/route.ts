import { NextRequest, NextResponse } from 'next/server';
import {
  FAVORITE_WORKSPACE_KEYS,
  createFavoriteSku,
  listFavoriteSkus,
  type FavoriteWorkspaceKey,
} from '@/lib/favorites/sku-favorites';

function parseWorkspaceKey(value: string | null): FavoriteWorkspaceKey | null {
  if (!value) return null;
  return FAVORITE_WORKSPACE_KEYS.includes(value as FavoriteWorkspaceKey)
    ? (value as FavoriteWorkspaceKey)
    : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceKey = parseWorkspaceKey(searchParams.get('workspace'));

    if (!workspaceKey) {
      return NextResponse.json({ error: 'workspace is required' }, { status: 400 });
    }

    const favorites = await listFavoriteSkus(workspaceKey);
    return NextResponse.json({ favorites, count: favorites.length, workspaceKey });
  } catch (error: any) {
    console.error('GET /api/favorites error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch favorites', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const workspaceKey = parseWorkspaceKey(body?.workspaceKey ?? null);

    if (!workspaceKey) {
      return NextResponse.json({ error: 'workspaceKey is required' }, { status: 400 });
    }

    const favorite = await createFavoriteSku({
      workspaceKey,
      ecwidProductId: body?.ecwidProductId,
      sku: body?.sku,
      label: body?.label,
      productTitle: body?.productTitle,
      issueTemplate: body?.issueTemplate,
      defaultPrice: body?.defaultPrice,
      notes: body?.notes,
      sortOrder: body?.sortOrder,
      isActive: body?.isActive,
      staffId: body?.staffId,
    });

    return NextResponse.json({ success: true, favorite });
  } catch (error: any) {
    console.error('POST /api/favorites error:', error);
    return NextResponse.json(
      { error: 'Failed to create favorite', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
