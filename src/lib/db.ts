// Single-driver pool: `@neondatabase/serverless` over WebSocket.
//
// Same driver in dev and prod so:
//   - Neon compute wake/sleep is handled by the driver (no stale TCP).
//   - Behavior matches production; no "works on my machine" surprises.
//
// Long-running scripts under `scripts/` and the pm2 pipeline use raw `pg`
// directly and are unaffected by this change.
import { Pool as NeonPool } from '@neondatabase/serverless';
import type { Pool as PgPool } from 'pg';

// Load .env when running outside the Next.js runtime (e.g. standalone scripts).
// Next.js automatically loads .env/.env.local during dev/build, so this is a no-op there.
if (!process.env.NEXT_RUNTIME) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch { /* dotenv optional for non-script contexts */ }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

// Generous connection timeout absorbs Neon compute cold-start (can be 15-25s).
const connectionTimeoutMillis = readPositiveInt(process.env.PG_CONNECTION_TIMEOUT_MS, 30000);
const queryTimeoutMillis = readPositiveInt(process.env.PG_QUERY_TIMEOUT_MS, 30000);
const idleTxTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TX_TIMEOUT_MS, 30000);
// WebSocket-backed pool — keep concurrency modest.
const poolMax = readPositiveInt(process.env.PG_POOL_MAX, 5);
const idleTimeoutMillis = readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 10000);

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';

const basePoolOptions = {
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    idle_in_transaction_session_timeout: idleTxTimeoutMillis,
    max: poolMax,
    idleTimeoutMillis,
    options: '-c timezone=America/Los_Angeles',
};

// Default (privileged) pool — connects as the DB owner (neondb_owner today).
// Raw `@/lib/db` importers use this; the owner BYPASSes RLS, so not-yet-migrated
// routes keep working against ENABLE-but-not-FORCE tables during the rollout.
// Typed as PgPool because callers use `pool.query<T>()` / `pool.connect()` generics.
// NeonPool exposes a compatible surface for our usage; cast at construction.
const pool: PgPool = new NeonPool({
    connectionString,
    ...basePoolOptions,
}) as unknown as PgPool;

// Tenant-runtime pool. Once the non-BYPASSRLS `app_tenant` role is provisioned
// (Phase E1) and TENANT_APP_DATABASE_URL points at its DSN, the GUC wrappers
// (withTenantConnection / tenantQuery / withTenantTransaction in
// src/lib/tenancy/db.ts) run on THIS pool, so RLS policies actually apply to
// those code paths and per-table FORCE can be turned on incrementally. Until the
// env var is set it ALIASES the owner pool, so behavior is unchanged today.
// See docs/tier0-go-live-runbook.md and the tenancy exec plan §Phase E1.
const tenantConnectionString = process.env.TENANT_APP_DATABASE_URL || '';
export const tenantPool: PgPool = tenantConnectionString
    ? (new NeonPool({
        connectionString: tenantConnectionString,
        ...basePoolOptions,
    }) as unknown as PgPool)
    : pool;

export default pool;
