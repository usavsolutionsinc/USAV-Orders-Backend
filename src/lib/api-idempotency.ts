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

// ─── Reserve-up-front claim (concurrent-safe) ──────────────────────────────
//
// withIdempotentResponse (above) reads the cache, runs produce(), then writes
// the result. Two requests with the SAME key that arrive while the first is
// still in produce() BOTH miss the read and BOTH run produce() — a concurrent
// double-fire (e.g. a fast double-submit re-running an external Zoho receive).
// withIdempotencyClaim closes that gap by RESERVING the key up front: the first
// request claims a pending row; a concurrent second either replays the finished
// response or gets a 409 "in progress" — it never runs produce() too. A claim
// abandoned by a crash self-heals after IDEMPOTENCY_STALE_CLAIM_MS.
//
// Additive: getApiIdempotencyResponse / saveApiIdempotencyResponse are
// unchanged, so routes still using the read-then-write pattern are unaffected.

/** status_code sentinel marking an in-flight (claimed, not finalized) row. */
const IDEMPOTENCY_PENDING_STATUS = 0;
/** A pending claim older than this (ms) is treated as abandoned and reclaimable. */
const IDEMPOTENCY_STALE_CLAIM_MS = 90_000;

type ClaimParams = {
  orgId: OrgId;
  idempotencyKey: string;
  route: string;
  staffId: number | null;
};

export type IdempotencyClaimResult<B> = {
  status: number;
  body: B;
  /** true when returned from a previously-finalized response (replay). */
  cached: boolean;
  /** true when another request holds an in-flight claim (concurrent duplicate). */
  inProgress?: boolean;
};

async function tryClaim(
  db: Pick<Pool, 'query'>,
  p: ClaimParams,
): Promise<'won' | 'lost' | 'no-table'> {
  try {
    const r = await db.query(
      `INSERT INTO api_idempotency_responses
         (organization_id, idempotency_key, route, staff_id, status_code, response_body)
       VALUES ($1, $2, $3, $4, ${IDEMPOTENCY_PENDING_STATUS}, '{"__pending__":true}'::jsonb)
       ON CONFLICT (idempotency_key, route) DO NOTHING
       RETURNING idempotency_key`,
      [p.orgId, p.idempotencyKey, p.route, p.staffId],
    );
    return r.rows.length > 0 ? 'won' : 'lost';
  } catch (err) {
    if (isIdempotencyTableMissing(err)) return 'no-table';
    throw err;
  }
}

async function takeOverStaleClaim(db: Pick<Pool, 'query'>, p: ClaimParams): Promise<boolean> {
  // Atomically reclaim a pending row whose claim is older than the stale window.
  // Two racers both run this UPDATE; only one matches the row (the other sees
  // created_at already bumped) so exactly one takes over.
  const r = await db.query(
    `UPDATE api_idempotency_responses
        SET created_at = NOW(), staff_id = $4
      WHERE idempotency_key = $2 AND route = $3
        AND status_code = ${IDEMPOTENCY_PENDING_STATUS}
        AND created_at < NOW() - INTERVAL '${IDEMPOTENCY_STALE_CLAIM_MS} milliseconds'
      RETURNING idempotency_key`,
    [p.orgId, p.idempotencyKey, p.route, p.staffId],
  );
  return r.rows.length > 0;
}

/** Finalize a claimed pending row with the real response. Table-missing safe. */
export async function finalizeIdempotencyClaim(
  db: Pick<Pool, 'query'>,
  p: ClaimParams,
  out: { status: number; body: Record<string, unknown> },
): Promise<void> {
  try {
    await db.query(
      `UPDATE api_idempotency_responses
          SET status_code = $5, response_body = $6::jsonb, staff_id = $4
        WHERE idempotency_key = $2 AND route = $3`,
      [p.orgId, p.idempotencyKey, p.route, p.staffId, out.status, JSON.stringify(out.body)],
    );
  } catch (err) {
    if (isIdempotencyTableMissing(err)) return;
    throw err;
  }
}

/**
 * Drop a still-pending claim (never a finalized row) so a retry can proceed.
 * Call on a 5xx result or a thrown error. Table-missing safe.
 */
export async function releaseIdempotencyClaim(
  db: Pick<Pool, 'query'>,
  p: Pick<ClaimParams, 'idempotencyKey' | 'route'>,
): Promise<void> {
  try {
    await db.query(
      `DELETE FROM api_idempotency_responses
        WHERE idempotency_key = $1 AND route = $2 AND status_code = ${IDEMPOTENCY_PENDING_STATUS}`,
      [p.idempotencyKey, p.route],
    );
  } catch (err) {
    if (isIdempotencyTableMissing(err)) return;
    throw err;
  }
}

export type ClaimOutcome<B> =
  /** A finalized response already exists — return it, do NOT run the work. */
  | { outcome: 'replay'; status: number; body: B }
  /** A concurrent duplicate holds an in-flight claim — caller should 409. */
  | { outcome: 'in_progress' }
  /** Caller owns the claim — run the work, then finalize/release. */
  | { outcome: 'proceed' };

/**
 * Reserve the idempotency key up front. Returns:
 *   - 'replay'      → a finished response exists; return it without working.
 *   - 'in_progress' → another request is mid-flight with this key; 409.
 *   - 'proceed'     → you own the claim. Run the work, then call
 *                     finalizeIdempotencyClaim (on success/4xx) or
 *                     releaseIdempotencyClaim (on 5xx/throw).
 *
 * This is what closes the concurrent-double-fire gap that the read-then-write
 * pattern (getApiIdempotencyResponse → produce → saveApiIdempotencyResponse)
 * leaves open: two requests with the same key both miss the read and both run.
 * An abandoned claim (crash mid-flight) self-heals after IDEMPOTENCY_STALE_CLAIM_MS.
 */
export async function claimOrReplay<B extends Record<string, unknown>>(
  db: Pick<Pool, 'query'>,
  p: ClaimParams,
): Promise<ClaimOutcome<B>> {
  // Fast path: a finalized response already exists.
  const existing = await getApiIdempotencyResponse(db, p.orgId, p.idempotencyKey, p.route);
  if (existing && existing.status_code !== IDEMPOTENCY_PENDING_STATUS) {
    return { outcome: 'replay', status: existing.status_code, body: existing.response_body as B };
  }

  const claim = await tryClaim(db, p);
  // 'no-table' → idempotency not deployed; degrade to "just run it" (no claim row
  // to finalize, but finalize/release are table-missing safe, so 'proceed' works).
  if (claim === 'won' || claim === 'no-table') return { outcome: 'proceed' };

  // 'lost' → someone else claimed first. Finished, or still pending?
  const after = await getApiIdempotencyResponse(db, p.orgId, p.idempotencyKey, p.route);
  if (after && after.status_code !== IDEMPOTENCY_PENDING_STATUS) {
    return { outcome: 'replay', status: after.status_code, body: after.response_body as B };
  }
  // Still pending — only take it over if the holder abandoned it (stale).
  const reclaimed = await takeOverStaleClaim(db, p);
  return reclaimed ? { outcome: 'proceed' } : { outcome: 'in_progress' };
}

/**
 * Convenience wrapper around claimOrReplay for handlers whose whole body fits in
 * a single produce() callback. (mark-received-po orchestrates the primitives
 * directly because its work spans many return points.)
 */
export async function withIdempotencyClaim<B extends Record<string, unknown>>(
  db: Pick<Pool, 'query'>,
  params: ClaimParams & { idempotencyKey: string | null },
  produce: () => Promise<{ status: number; body: B }>,
): Promise<IdempotencyClaimResult<B>> {
  if (!params.idempotencyKey) {
    return { ...(await produce()), cached: false };
  }
  const p: ClaimParams = {
    orgId: params.orgId,
    idempotencyKey: params.idempotencyKey,
    route: params.route,
    staffId: params.staffId,
  };

  const claim = await claimOrReplay<B>(db, p);
  if (claim.outcome === 'replay') {
    return { status: claim.status, body: claim.body, cached: true };
  }
  if (claim.outcome === 'in_progress') {
    return {
      status: 409,
      body: {
        error: 'A duplicate request with this Idempotency-Key is already in progress.',
        idempotent_in_progress: true,
      } as unknown as B,
      cached: false,
      inProgress: true,
    };
  }

  try {
    const out = await produce();
    if (out.status < 500) {
      await finalizeIdempotencyClaim(db, p, out);
    } else {
      await releaseIdempotencyClaim(db, p);
    }
    return { ...out, cached: false };
  } catch (err) {
    await releaseIdempotencyClaim(db, p).catch(() => {});
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
