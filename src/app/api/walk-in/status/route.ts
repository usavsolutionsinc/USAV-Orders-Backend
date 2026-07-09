import { NextRequest, NextResponse } from 'next/server';
import { formatSquareErrors, type SquareConfig } from '@/lib/square/client';
import { resolveSquareConfig, squareFetchForOrg } from '@/lib/square/server';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/walk-in/status
 * Ping Square API to verify connectivity, return location info, catalog count, and terminal devices.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    square_environment: process.env.SQUARE_ENVIRONMENT || 'PRODUCTION',
  };

  // Resolve the caller-org's Square config (Nango-connected token when present;
  // env fallback). All diagnostics below report on the caller-org's account,
  // not the shared env account.
  let cfg: SquareConfig;
  try {
    cfg = await resolveSquareConfig(ctx.organizationId);
    results.config = {
      baseUrl: cfg.baseUrl,
      locationId: cfg.locationId,
      version: cfg.version,
      currency: cfg.currency,
      hasAccessToken: !!cfg.accessToken,
    };
  } catch (error: any) {
    results.config_error = error?.message || 'Failed to load Square config';
    return NextResponse.json(results, { status: 500 });
  }

  // 1. Location ping
  try {
    const locationResult = await squareFetchForOrg<{ location?: Record<string, unknown> }>(
      ctx.organizationId,
      `/locations/${cfg.locationId}`,
    );
    if (locationResult.ok) {
      const loc = locationResult.data.location as any;
      results.location = {
        ok: true,
        id: loc?.id,
        name: loc?.name,
        status: loc?.status,
        currency: loc?.currency,
        country: loc?.country,
        timezone: loc?.timezone,
      };
    } else {
      results.location = { ok: false, error: formatSquareErrors(locationResult.errors) };
    }
  } catch (error: any) {
    results.location = { ok: false, error: error?.message };
  }

  // 2. Catalog count
  try {
    const catalogResult = await squareFetchForOrg<{ objects?: unknown[]; cursor?: string }>(
      ctx.organizationId,
      '/catalog/search',
      { method: 'POST', body: { object_types: ['ITEM'], limit: 1 } },
    );
    if (catalogResult.ok) {
      results.catalog = {
        ok: true,
        has_items: (catalogResult.data.objects || []).length > 0,
        has_more: !!catalogResult.data.cursor,
      };
    } else {
      results.catalog = { ok: false, error: formatSquareErrors(catalogResult.errors) };
    }
  } catch (error: any) {
    results.catalog = { ok: false, error: error?.message };
  }

  // 3. Terminal devices
  try {
    const devicesResult = await squareFetchForOrg<{ devices?: Array<Record<string, unknown>> }>(
      ctx.organizationId,
      '/devices',
    );
    if (devicesResult.ok) {
      const devices = (devicesResult.data.devices || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        product_type: d.product_type,
      }));
      results.terminal_devices = { ok: true, count: devices.length, devices };
    } else {
      results.terminal_devices = { ok: false, error: formatSquareErrors(devicesResult.errors) };
    }
  } catch (error: any) {
    results.terminal_devices = { ok: false, error: error?.message };
  }

  // 4. Customers (quick test)
  try {
    const custResult = await squareFetchForOrg<{ customers?: unknown[] }>(
      ctx.organizationId,
      '/customers/search',
      { method: 'POST', body: { limit: 1 } },
    );
    if (custResult.ok) {
      results.customers = {
        ok: true,
        has_customers: (custResult.data.customers || []).length > 0,
      };
    } else {
      results.customers = { ok: false, error: formatSquareErrors(custResult.errors) };
    }
  } catch (error: any) {
    results.customers = { ok: false, error: error?.message };
  }

  const allOk = ['location', 'catalog', 'customers'].every(
    (key) => (results[key] as any)?.ok === true,
  );

  return NextResponse.json({ ...results, all_ok: allOk }, { status: allOk ? 200 : 207 });
}, { permission: 'walk_in.view', feature: 'walkIn' });
