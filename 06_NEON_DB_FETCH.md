# 06 — Neon DB Fetch Logic Improvements

---

## Goals

- Enable connection pooling via Neon's serverless driver (eliminates cold-start latency)
- Centralise all DB access through a single `db.ts` client module
- Wrap every query in consistent error handling and structured logging
- Add typed query builders to eliminate raw string SQL
- Support transactional operations cleanly
- Implement query result caching integration with the ID-keyed cache layer

---

## 1. Dependencies

```bash
npm install @neondatabase/serverless
npm install drizzle-orm drizzle-kit          # optional but strongly recommended
npm install --save-dev @types/pg
```

---

## 2. Neon Client Module

**Location:** `src/lib/db.ts`

```ts
import { neon, neonConfig, Pool } from '@neondatabase/serverless';

// Enable WebSocket pooling for serverless environments
neonConfig.webSocketConstructor = WebSocket; // only needed in non-Node environments
neonConfig.poolQueryViaFetch = true;          // use HTTP fetch for single queries

const DATABASE_URL = import.meta.env.VITE_DATABASE_URL;
if (!DATABASE_URL) throw new Error('VITE_DATABASE_URL is not set');

// ─── HTTP client (best for single, infrequent queries) ────────────────────────
export const sql = neon(DATABASE_URL);

// ─── Pooled client (best for high-frequency or transactional queries) ─────────
export const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * Executes a single SQL query via the HTTP transport.
 * Use for simple reads/writes in serverless functions.
 *
 * @example
 * const users = await query<User>`SELECT * FROM users WHERE id = ${id}`;
 */
export async function query<T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  try {
    const result = await sql<T>(strings, ...values);
    return result as T[];
  } catch (err) {
    handleDbError(err, 'query');
    throw err;
  }
}

/**
 * Executes a query inside a pooled transaction.
 * Automatically rolls back on error.
 *
 * @example
 * await transaction(async (client) => {
 *   await client.query('INSERT INTO ...');
 *   await client.query('UPDATE ...');
 * });
 */
export async function transaction<T>(
  fn: (client: Awaited<ReturnType<typeof pool.connect>>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    handleDbError(err, 'transaction');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Error handling ───────────────────────────────────────────────────────────

function handleDbError(err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  if (import.meta.env.DEV) {
    console.error(`[DB Error] ${context}: ${message}`, err);
  } else {
    // In production: send to your error logger (Sentry, Datadog, etc.)
    console.error(`[DB Error] ${context}: ${message}`);
  }
}
```

---

## 3. Typed Query Layer

Avoid raw strings scattered across files. Centralise queries by domain:

**`src/lib/queries/users.ts`**

```ts
import { query, transaction } from '@/lib/db';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

/** Fetch a single user by ID */
export async function getUserById(id: string): Promise<User | null> {
  const rows = await query<User>`
    SELECT id, email, name, created_at as "createdAt"
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Fetch all users (paginated) */
export async function getUsers(page = 1, pageSize = 20): Promise<User[]> {
  const offset = (page - 1) * pageSize;
  return query<User>`
    SELECT id, email, name, created_at as "createdAt"
    FROM users
    ORDER BY created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
}

/** Create a new user */
export async function createUser(data: Pick<User, 'email' | 'name'>): Promise<User> {
  const rows = await query<User>`
    INSERT INTO users (email, name)
    VALUES (${data.email}, ${data.name})
    RETURNING id, email, name, created_at as "createdAt"
  `;
  return rows[0];
}

/** Update user fields */
export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'email' | 'name'>>,
): Promise<User | null> {
  const rows = await query<User>`
    UPDATE users
    SET
      email = COALESCE(${data.email ?? null}, email),
      name  = COALESCE(${data.name  ?? null}, name)
    WHERE id = ${id}
    RETURNING id, email, name, created_at as "createdAt"
  `;
  return rows[0] ?? null;
}

/** Delete user */
export async function deleteUser(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>`
    DELETE FROM users WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}
```

---

## 4. Integrating with the Cache Layer

Combine query functions with `cacheGet`/`cacheSet` for automatic result caching:

```ts
import { cacheGet, cacheSet } from '@/lib/cache';
import { getUserById } from '@/lib/queries/users';
import { CACHE_DOMAINS } from '@/lib/cacheDomains';

/** Cached user fetch — reads cache first, falls back to DB */
export async function getCachedUser(id: string) {
  const cached = cacheGet<User>(CACHE_DOMAINS.USER, id);
  if (cached) return cached;

  const user = await getUserById(id);
  if (user) cacheSet(CACHE_DOMAINS.USER, id, user, 10 * 60 * 1000);
  return user;
}
```

---

## 5. API Route Pattern (Vite/SvelteKit/Remix/Next — adapt as needed)

For server-side or edge functions calling Neon:

```ts
// src/api/users/[id].ts (Vite plugin or edge function)
import { getCachedUser } from '@/lib/queries/users';
import { safeAwait } from '@/utils';

export async function GET({ params }: { params: { id: string } }) {
  const [user, err] = await safeAwait(getCachedUser(params.id));

  if (err) {
    return Response.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
  if (!user) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(user);
}
```

---

## 6. Connection Pooling Notes

| Transport | Use when |
|-----------|----------|
| `sql` (HTTP) | Serverless functions, Vercel Edge, single queries |
| `pool` (WebSocket) | Long-running servers, transactions, high frequency |

**Neon-specific:** Always set `neonConfig.poolQueryViaFetch = true` in serverless environments to avoid WebSocket cold-start overhead for simple queries.

---

## 7. Environment Variables

```env
# .env.local
VITE_DATABASE_URL=postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
```

**Never** commit `.env.local`. Add it to `.gitignore`.

For production deployments, set `DATABASE_URL` in your hosting provider's environment variable dashboard.

---

## 8. Query Performance Patterns

### Use `LIMIT` on all list queries

```ts
// ❌ No limit — could return thousands of rows
await query`SELECT * FROM posts`

// ✅ Always paginate
await query`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`
```

### Use `RETURNING` to avoid extra round-trips

```ts
// ❌ Two queries: insert + select
await query`INSERT INTO posts (title) VALUES (${title})`;
const post = await query`SELECT * FROM posts WHERE title = ${title}`;

// ✅ One query with RETURNING
const [post] = await query`
  INSERT INTO posts (title) VALUES (${title})
  RETURNING *
`;
```

### Use partial selects on wide tables

```ts
// ❌ Fetching all columns when only a few are needed
await query`SELECT * FROM users`

// ✅ Select only what the component needs
await query`SELECT id, name, avatar_url FROM users`
```

---

## 9. Checklist

- [ ] `@neondatabase/serverless` installed
- [ ] `src/lib/db.ts` created with `sql`, `pool`, `query`, and `transaction` exports
- [ ] `src/lib/queries/` directory created with domain files
- [ ] All raw `fetch('/api/...')` calls replaced with typed query functions
- [ ] All queries use tagged template literals (SQL injection safe)
- [ ] All list queries have `LIMIT` + `OFFSET`
- [ ] Insert/Update queries use `RETURNING` instead of double-fetch
- [ ] Cache integration on all high-frequency read queries
- [ ] `VITE_DATABASE_URL` documented in `.env.example`
- [ ] Error handling calls `handleDbError` in every catch block
- [ ] Transaction used for all multi-step write operations
