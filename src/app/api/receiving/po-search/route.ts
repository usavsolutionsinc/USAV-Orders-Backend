import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Read-only PO typeahead for the Package Pairing "Link a PO" tab.
 *
 * LOCAL mirror first (`zoho_po_mirror`) — no Zoho round-trip, no side effects.
 * This is deliberately pure: it never creates/adopts a carton (that's
 * lookup-po's job). The "Link a PO" tab calls this to pick a PO, then POSTs
 * /api/receiving/relink to write the linkage. Org-scoped (the mirror carries
 * organization_id since the 2026-06-14 org phase).
 *
 * Matches PO# (normalized), reference# (normalized), raw PO#, or vendor name.
 *   GET /api/receiving/po-search?q=6000  →  { success, candidates: PoCandidate[] }
 */
interface PoCandidateRow {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string | null;
  reference_number: string | null;
  vendor_name: string | null;
  status: string | null;
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  // Empty/short query → return the most recently synced POs (the locally stored
  // incoming PO mirror) so the tab lists them by default; ≥2 chars filters.
  const hasQuery = q.length >= 2;
  const norm = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const like = `%${q}%`;

  const { rows } = await tenantQuery<PoCandidateRow>(
    ctx.organizationId,
    `SELECT zoho_purchaseorder_id,
            zoho_purchaseorder_number,
            reference_number,
            vendor_name,
            status
       FROM zoho_po_mirror
      WHERE organization_id = $1
        AND ($4 = false OR (
          ($2 <> '' AND zoho_purchaseorder_number_norm LIKE '%' || $2 || '%')
          OR ($2 <> '' AND NULLIF(upper(regexp_replace(COALESCE(reference_number, ''), '[^A-Za-z0-9]', '', 'g')), '') LIKE '%' || $2 || '%')
          OR zoho_purchaseorder_number ILIKE $3
          OR vendor_name ILIKE $3
        ))
      ORDER BY last_synced_at DESC NULLS LAST
      LIMIT 20`,
    [ctx.organizationId, norm, like, hasQuery],
  );

  return NextResponse.json({
    success: true,
    candidates: rows.map((r) => ({
      zoho_purchaseorder_id: String(r.zoho_purchaseorder_id),
      zoho_purchaseorder_number: r.zoho_purchaseorder_number,
      reference_number: r.reference_number,
      vendor_name: r.vendor_name,
      status: r.status,
    })),
  });
}, { permission: 'receiving.scan_po' });
