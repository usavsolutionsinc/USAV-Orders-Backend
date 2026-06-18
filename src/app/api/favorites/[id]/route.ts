import { NextRequest, NextResponse } from 'next/server';
import {
  FAVORITE_WORKSPACE_KEYS,
  deleteFavoriteSku,
  updateFavoriteSku,
  type FavoriteWorkspaceKey,
} from '@/lib/favorites/sku-favorites';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

function parseWorkspaceKey(value: string | null): FavoriteWorkspaceKey | null {
  if (!value) return null;
  return FAVORITE_WORKSPACE_KEYS.includes(value as FavoriteWorkspaceKey)
    ? (value as FavoriteWorkspaceKey)
    : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'sku_stock.manage');
  if (gate.denied) return gate.denied;
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    const body = await req.json();
    const workspaceKey = parseWorkspaceKey(body?.workspaceKey ?? null);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid favorite id' }, { status: 400 });
    }
    if (!workspaceKey) {
      return NextResponse.json({ error: 'workspaceKey is required' }, { status: 400 });
    }

    const favorite = await updateFavoriteSku({
      id,
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
      staffId: gate.ctx.staffId,
    }, gate.ctx.organizationId);

    if (!favorite) {
      return NextResponse.json({ error: 'Favorite not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, favorite });
  } catch (error: any) {
    console.error('PATCH /api/favorites/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update favorite', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'sku_stock.manage');
  if (gate.denied) return gate.denied;
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    const { searchParams } = new URL(req.url);
    const workspaceKey = parseWorkspaceKey(searchParams.get('workspace'));

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid favorite id' }, { status: 400 });
    }
    if (!workspaceKey) {
      return NextResponse.json({ error: 'workspace is required' }, { status: 400 });
    }

    const deleted = await deleteFavoriteSku(id, workspaceKey, gate.ctx.organizationId);
    if (!deleted) {
      return NextResponse.json({ error: 'Favorite not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/favorites/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete favorite', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
