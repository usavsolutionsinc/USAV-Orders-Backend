import { NextRequest, NextResponse } from 'next/server';
import { updateIssueTemplate, deleteIssueTemplate } from '@/lib/neon/repair-issue-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { OrgId } from '@/lib/tenancy/constants';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'repair.intake');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid issue id' }, { status: 400 });
    }

    const body = await req.json();
    const issue = await updateIssueTemplate(id, {
      label: body?.label,
      category: body?.category,
      sort_order: body?.sortOrder,
      active: body?.active,
    }, gate.ctx.organizationId as OrgId);

    if (!issue) {
      return NextResponse.json({ error: 'Issue template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, issue });
  } catch (error: any) {
    console.error('PUT /api/repair/issues/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update issue template', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'repair.intake');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = Number(rawId);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid issue id' }, { status: 400 });
    }

    const deleted = await deleteIssueTemplate(id, gate.ctx.organizationId as OrgId);
    if (!deleted) {
      return NextResponse.json({ error: 'Issue template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/repair/issues/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete issue template', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
