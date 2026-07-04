/**
 * Test-only side-effect module: ensures a well-formed DATABASE_URL is present
 * before any module that transitively loads @/lib/drizzle/db (whose neon()
 * validates the URL format at load). Import this FIRST — its side effect runs
 * in import order, ahead of a later `import '@/lib/workflow'`. No connection is
 * ever opened; DB-free tests route every query through injected fakes.
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
export {};
