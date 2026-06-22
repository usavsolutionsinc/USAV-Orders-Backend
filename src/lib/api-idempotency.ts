import type { Pool } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';

export type ApiIdempotencyHit = {
  status_code: number;
  response_body: Record<string, unknown>;
};

function isIdempotencyTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '42P01' && String(e?.message || '').includes('api_idempotency_responses');
}

export async function getApiIdempotencyResponse(
  db: Pick<Pool, 'query'>,
  orgId: OrgId,
  idempotencyKey: string,
  route: string,
): Promise<ApiIdempotencyHit | null> {
  try {
    // org-filtered: a key collision across tenants can never serve another
    // tenant's cached body (the cross-tenant idempotency-cache leak).
    const r = await db.query(
      `SELECT status_code, response_body
       FROM api_idempotency_responses
       WHERE organization_id = $1 AND idempotency_key = $2 AND route = $3`,
      [orgId, idempotencyKey, route],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      status_code: Number(row.status_code),
      response_body: row.response_body as Record<string, unknown>,
    };
  } catch (err) {
    if (isIdempotencyTableMissing(err)) return null;
    throw err;
  }
}

export async function saveApiIdempotencyResponse(
  db: Pick<Pool, 'query'>,
  params: {
    orgId: OrgId;
    idempotencyKey: string;
    route: string;
    staffId: number | null;
    statusCode: number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // organization_id stamped so the cache row is owned by its tenant. ON
    // CONFLICT target stays (idempotency_key, route) — see the migration header
    // for why the PK isn't flipped to composite yet (deploy-ordering safety).
    await db.query(
      `INSERT INTO api_idempotency_responses
         (organization_id, idempotency_key, route, staff_id, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (idempotency_key, route) DO NOTHING`,
      [
        params.orgId,
        params.idempotencyKey,
        params.route,
        params.staffId,
        params.statusCode,
        JSON.stringify(params.responseBody),
      ],
    );
  } catch (err) {
    if (isIdempotencyTableMissing(err)) return;
    throw err;
  }
}

export function readIdempotencyKey(req: Request, bodyKey?: string | null): string | null {
  const fromHeader = req.headers.get('Idempotency-Key')?.trim();
  const fromBody = bodyKey?.trim();
  return fromHeader || fromBody || null;
}

/**
 * Wrap a handler that produces a {status, body} pair with response-level
 * idempotency. When idempotencyKey is set and a prior response exists, returns
 * the cached pair without invoking produce(). Otherwise runs produce() and
 * persists status<500 responses. 5xx is treated as transient and not cached so
 * the next retry can succeed.
 */
export async function withIdempotentResponse<B extends Record<string, unknown>>(
  db: Pick<Pool, 'query'>,
  params: {
    orgId: OrgId;
    idempotencyKey: string | null;
    route: string;
    staffId: number | null;
  },
  produce: () => Promise<{ status: number; body: B }>,
): Promise<{ status: number; body: B; cached: boolean }> {
  if (params.idempotencyKey) {
    const cached = await getApiIdempotencyResponse(
      db,
      params.orgId,
      params.idempotencyKey,
      params.route,
    );
    if (cached) {
      return {
        status: cached.status_code,
        body: cached.response_body as B,
        cached: true,
      };
    }
  }

  const out = await produce();

  if (params.idempotencyKey && out.status < 500) {
    await saveApiIdempotencyResponse(db, {
      orgId: params.orgId,
      idempotencyKey: params.idempotencyKey,
      route: params.route,
      staffId: params.staffId,
      statusCode: out.status,
      responseBody: out.body,
    });
  }

  return { ...out, cached: false };
}
