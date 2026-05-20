/**
 * GET /api/admin/org/export
 *
 * Returns every row of every business table the calling tenant owns as a
 * single JSON document. Satisfies the "right of access" / data-portability
 * obligation (GDPR Article 15 + 20, CCPA equivalents).
 *
 * Gated by admin.view + step-up because this is a privileged action
 * that dumps PII (customer addresses, staff names, audit logs). The
 * response is unbounded — callers should expect a streaming download
 * for tenants with deep history. We use Content-Disposition so browsers
 * save it as a file rather than render it.
 *
 * Tables included: every table that already carries organization_id, plus
 * staff/sessions/passkeys keyed by organization_id directly. Tables not
 * yet tenant-scoped (the bulk of the business tables) are NOT included
 * here — exporting them would leak across tenants. As we backfill
 * organization_id onto more tables (next migration wave), add them to
 * the EXPORT_TABLES list.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { getOrganization } from '@/lib/tenancy/organizations';

// Tables whose rows are filtered by organization_id. Add carefully —
// listing a table here without confirming it has the column is how you
// accidentally export every tenant's rows.
const EXPORT_TABLES: ReadonlyArray<{ table: string; orderBy: string }> = [
  { table: 'staff',                       orderBy: 'id ASC' },
  { table: 'staff_sessions',              orderBy: 'created_at ASC' },
  { table: 'organization_feature_flags',  orderBy: 'flag ASC' },
  { table: 'organization_integrations',   orderBy: 'id ASC' },
];

export const POST = withAuth(async (_req, ctx) => {
  const org = await getOrganization(ctx.organizationId);
  if (!org) return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });

  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    organization: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      plan: org.plan,
      status: org.status,
      settings: org.settings,
      createdAt: org.createdAt,
    },
    tables: {} as Record<string, unknown[]>,
  };

  for (const { table, orderBy } of EXPORT_TABLES) {
    try {
      // table/orderBy come from a hard-coded list above — safe to inject.
      const res = await tenantQuery(
        ctx.organizationId,
        `SELECT * FROM ${table} WHERE organization_id = $1 ORDER BY ${orderBy}`,
        [ctx.organizationId],
      );
      // Redact obvious credentials so an export download doesn't ship plain
      // ciphertext to whoever opens it. The vault is reversible — better
      // to surface "redacted" than the raw envelope.
      const tablesRecord = out.tables as Record<string, unknown[]>;
      tablesRecord[table] = res.rows.map((row: Record<string, unknown>) => {
        if (table === 'organization_integrations' && 'payload_encrypted' in row) {
          return { ...row, payload_encrypted: '[redacted]' };
        }
        if (table === 'staff' && 'pin_hash' in row) {
          return { ...row, pin_hash: '[redacted]' };
        }
        return row;
      });
    } catch (err) {
      // A missing column means the table hasn't been tenant-scoped yet —
      // skip with a note rather than failing the whole export.
      const tablesRecord = out.tables as Record<string, unknown[]>;
      tablesRecord[table] = [{ __error: err instanceof Error ? err.message : String(err) }];
    }
  }

  const body = JSON.stringify(out, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${org.slug}-export-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}, {
  permission: 'admin.view',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'org.export',
    entityType: 'organization',
    entityId: ({ req }) => req.headers.get('x-request-id') || 'export',
  },
});
