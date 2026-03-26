import type { Pool } from 'pg';

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
  idempotencyKey: string,
  route: string,
): Promise<ApiIdempotencyHit | null> {
  try {
    const r = await db.query(
      `SELECT status_code, response_body
       FROM api_idempotency_responses
       WHERE idempotency_key = $1 AND route = $2`,
      [idempotencyKey, route],
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
    idempotencyKey: string;
    route: string;
    staffId: number | null;
    statusCode: number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO api_idempotency_responses
         (idempotency_key, route, staff_id, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (idempotency_key, route) DO NOTHING`,
      [
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
