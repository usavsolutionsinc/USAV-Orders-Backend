#!/usr/bin/env tsx
/**
 * One-off backfill: run the receiving-triage → feed_memberships projection once
 * against the live DB (universal-feed plan Phase 4). Idempotent + additive — the
 * `/api/cron/feed-membership-projection` cron maintains it every 10 min after
 * deploy; this just seeds current state (and validates the real SQL).
 *
 *   npx tsx scripts/backfill-triage-feed-memberships.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const { projectReceivingTriageMemberships } = await import('../src/lib/receiving/feed-membership-projection');
  const res = await projectReceivingTriageMemberships(90);
  console.log('[backfill] receiving_triage feed_memberships:', JSON.stringify(res));
  process.exit(res.success ? 0 : 1);
}

void main();
