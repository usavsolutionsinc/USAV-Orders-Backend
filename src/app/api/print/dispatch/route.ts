import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  buildBinZpl,
  buildCartonZpl,
  buildProductZpl,
} from '@/lib/print/zpl-templates';

/**
 * POST /api/print/dispatch
 *
 * Body shape (discriminated by `class`):
 *   { class: 'carton',  profileId?, payload: CartonLabelInput }
 *   { class: 'product', profileId?, payload: ProductLabelInput }
 *   { class: 'bin',     profileId?, payload: BinLabelInput }
 *
 * Resolves a printer profile (explicit profileId → default-for-class →
 * any active profile of the vendor) and sends ZPL via the matching driver.
 *
 * PrintNode wiring is gated on PRINTNODE_API_KEY. When the env var is
 * absent we return `{ success: true, dispatched: false, zpl }` so the
 * caller can fall back to the existing browser popup printer.
 */

type LabelClass = 'carton' | 'product' | 'bin';

interface ProfileRow {
  id: number;
  name: string;
  external_id: string;
  vendor: 'printnode' | 'loftware';
}

async function resolveProfile(
  klass: LabelClass,
  profileIdHint: number | null,
): Promise<ProfileRow | null> {
  if (profileIdHint) {
    const r = await pool.query<ProfileRow>(
      `SELECT id, name, external_id, vendor
       FROM printer_profiles
       WHERE id = $1 AND is_active = true LIMIT 1`,
      [profileIdHint],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const r = await pool.query<ProfileRow>(
    `SELECT id, name, external_id, vendor
     FROM printer_profiles
     WHERE is_active = true
     ORDER BY
       CASE WHEN default_for = $1 THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`,
    [klass],
  );
  return r.rows[0] ?? null;
}

async function dispatchPrintNode(
  externalId: string,
  zpl: string,
  title: string,
): Promise<{ ok: boolean; status: number; jobId?: number; error?: string }> {
  const apiKey = process.env.PRINTNODE_API_KEY;
  if (!apiKey) return { ok: false, status: 0, error: 'PRINTNODE_API_KEY not configured' };
  try {
    const res = await fetch('https://api.printnode.com/printjobs', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        printerId: Number(externalId),
        title,
        contentType: 'raw_base64',
        content: Buffer.from(zpl).toString('base64'),
        source: 'usav-orders-backend',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    const jobId = typeof body === 'number' ? body : null;
    return { ok: true, status: res.status, jobId: jobId ?? undefined };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'PrintNode dispatch threw',
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const klass = String(body?.class || '').trim() as LabelClass;
    if (klass !== 'carton' && klass !== 'product' && klass !== 'bin') {
      return NextResponse.json(
        { error: 'class must be carton | product | bin' },
        { status: 400 },
      );
    }
    const profileIdHint =
      Number.isFinite(Number(body?.profileId)) && Number(body?.profileId) > 0
        ? Math.floor(Number(body?.profileId))
        : null;

    let zpl: string;
    let title: string;
    try {
      switch (klass) {
        case 'carton':
          zpl = buildCartonZpl(body.payload);
          title = `Carton ${body.payload?.poTail ?? ''}`;
          break;
        case 'product':
          zpl = buildProductZpl(body.payload);
          title = `Product ${body.payload?.sku ?? ''}`;
          break;
        case 'bin':
          zpl = buildBinZpl(body.payload);
          title = `Bin ${body.payload?.barcode ?? ''}`;
          break;
      }
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid payload', details: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }

    const profile = await resolveProfile(klass, profileIdHint);
    if (!profile) {
      // No printer configured — return the ZPL so the caller can fall back
      // to a browser-side printer (HTML popup, manual download, etc.).
      return NextResponse.json({
        success: true,
        dispatched: false,
        reason: 'NO_PRINTER_PROFILE',
        zpl,
      });
    }

    if (profile.vendor === 'printnode') {
      const result = await dispatchPrintNode(profile.external_id, zpl, title);
      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            dispatched: false,
            profile: { id: profile.id, name: profile.name },
            error: result.error || 'Dispatch failed',
            zpl,
          },
          { status: 502 },
        );
      }
      return NextResponse.json({
        success: true,
        dispatched: true,
        profile: { id: profile.id, name: profile.name, vendor: profile.vendor },
        job_id: result.jobId ?? null,
      });
    }

    // Loftware support stubbed — wire in vendor SDK when adopted.
    return NextResponse.json(
      {
        success: false,
        dispatched: false,
        error: `Vendor "${profile.vendor}" not yet implemented`,
        zpl,
      },
      { status: 501 },
    );
  } catch (err: any) {
    console.error('[POST /api/print/dispatch] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Print dispatch failed' },
      { status: 500 },
    );
  }
}
