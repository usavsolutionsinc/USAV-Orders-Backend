import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/assistant/mutations — the AI-edits tray feed (universal-feed plan
 * §-2.1). Recent agent_mutations for the org, newest-first, optionally scoped
 * to one draft definition via ?definitionId= (matched through
 * agent_mutation_affects). Read-only; org from ctx.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(50, Number(searchParams.get('limit')) || 20));
  const rawDef = Number(searchParams.get('definitionId'));
  const definitionId = Number.isFinite(rawDef) && rawDef > 0 ? rawDef : null;

  try {
    const rows = definitionId
      ? // Draft edits (workflow_draft.*, node_surface.*) all carry definitionId
        // in the payload — filter on that (the affects target_ref carries the
        // node/edge id, not the definition, so a target_ref LIKE would miss
        // add_node/add_edge). Cast the jsonb value to int to compare.
        await tenantQuery(
          ctx.organizationId,
          `SELECT id, mutation_kind, status, applied_at::text AS applied_at,
                  created_at::text AS created_at, proposed_by_staff_id
             FROM agent_mutations
            WHERE organization_id = $1
              AND (payload->>'definitionId')::int = $2
            ORDER BY created_at DESC, id DESC
            LIMIT $3`,
          [ctx.organizationId, definitionId, limit],
        )
      : await tenantQuery(
          ctx.organizationId,
          `SELECT id, mutation_kind, status, applied_at::text AS applied_at,
                  created_at::text AS created_at, proposed_by_staff_id
             FROM agent_mutations
            WHERE organization_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [ctx.organizationId, limit],
        );
    return NextResponse.json({ success: true, mutations: rows.rows });
  } catch (error) {
    console.error('Error in GET /api/assistant/mutations:', error);
    const message = error instanceof Error ? error.message : 'Failed to load mutations';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'assistant.chat' });
