import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { findUnitUidsBySerials, normalizeSerial } from '@/lib/neon/serial-units-queries';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/serial-units/resolve-batch
 *
 * Read-only batch reprint resolver. Given a list of manufacturer serials, return
 * each one's canonical minted `unit_uid` so a bulk / history reprint encodes the
 * SAME id the unit was born with (the reprint guarantee) — never a bare serial.
 * The single-item twin is POST /api/units/resolve-id; this batches the same idea
 * for the receiving-history bulk-print path without an N-round-trip loop.
 *
 * No mint, no write: a serial with no unit, or a unit not yet stamped with a uid,
 * comes back with `unit_uid: null` so the caller keeps its existing bare-serial
 * encoding. Every input serial is echoed back (caller's casing) in order, so the
 * client can map its selection 1:1.
 *
 *   { serials: ["SN123", "SN456"] }
 *     → { ok, units: [{ serial: "SN123", unit_uid: "00098-2621-000142" },
 *                      { serial: "SN456", unit_uid: null }] }
 *
 * Auth: `print.label` (this read exists only to feed the label print path).
 */
export const POST = withAuth(
  async (request, ctx) => {
    const orgId = ctx.organizationId as OrgId;
    const body = await request.json().catch(() => ({}));
    const rawSerials: unknown = body?.serials;
    if (!Array.isArray(rawSerials)) {
      return NextResponse.json(
        { ok: false, error: 'serials must be an array' },
        { status: 400 },
      );
    }

    // Trim + cap; keep the caller's casing for the echo. Bound the ANY() list so
    // an oversized selection can't blow up the query plan.
    const serials = rawSerials
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .slice(0, 500);
    if (serials.length === 0) {
      return NextResponse.json({ ok: true, units: [] });
    }

    try {
      const rows = await findUnitUidsBySerials(serials, orgId);
      const byNormalized = new Map(rows.map((r) => [r.normalized_serial, r]));
      const units = serials.map((serial) => {
        const row = byNormalized.get(normalizeSerial(serial));
        return {
          serial,
          unit_uid: row?.unit_uid ?? null,
          serial_unit_id: row?.id ?? null,
        };
      });
      return NextResponse.json({ ok: true, units });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'resolve-batch failed';
      console.error('[POST /api/serial-units/resolve-batch] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'print.label' },
);
