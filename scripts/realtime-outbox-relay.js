#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { Client } = require('pg');
const { randomUUID } = require('crypto');

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
const webhookSecret = process.env.REALTIME_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;

if (!databaseUrl) throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED is required');
if (!appUrl) throw new Error('APP_URL or NEXT_PUBLIC_APP_URL is required');
if (!webhookSecret) throw new Error('REALTIME_WEBHOOK_SECRET or WEBHOOK_SECRET is required');

const listenClient = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl ? { rejectUnauthorized: false } : false,
});

const workClient = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl ? { rejectUnauthorized: false } : false,
});

const BATCH_SIZE = Number(process.env.REALTIME_OUTBOX_BATCH_SIZE || 20);
const LOOP_DELAY_MS = Number(process.env.REALTIME_OUTBOX_LOOP_DELAY_MS || 1500);
let draining = false;

async function fetchBatch() {
  const claimToken = randomUUID();
  const result = await workClient.query(
    `WITH next_rows AS (
       SELECT id
       FROM realtime_outbox
       WHERE sent_at IS NULL
         AND (
           claimed_at IS NULL
           OR claimed_at < now() - interval '5 minutes'
         )
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE realtime_outbox ro
     SET claimed_at = now(),
         claim_token = $2
     FROM next_rows
     WHERE ro.id = next_rows.id
     RETURNING ro.id, ro.schema_name, ro.table_name, ro.pk, ro.op, ro.version, ro.actor_staff_id, ro.payload, ro.needs_refetch, ro.created_at, ro.claim_token`,
    [BATCH_SIZE, claimToken]
  );
  return result.rows;
}

async function markSent(id, claimToken) {
  await workClient.query(
    `UPDATE realtime_outbox
     SET sent_at = now(),
         attempt_count = attempt_count + 1,
         last_error = NULL,
         claimed_at = NULL,
         claim_token = NULL
     WHERE id = $1
       AND claim_token = $2`,
    [id, claimToken]
  );
}

async function markFailed(id, claimToken, errorMessage) {
  await workClient.query(
    `UPDATE realtime_outbox
     SET attempt_count = attempt_count + 1,
         last_error = $3,
         claimed_at = NULL,
         claim_token = NULL
     WHERE id = $1
       AND claim_token = $2`,
    [id, claimToken, errorMessage.slice(0, 1000)]
  );
}

async function postEvent(row) {
  const res = await fetch(`${appUrl.replace(/\/$/, '')}/api/webhooks/realtime-db`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': webhookSecret,
    },
    body: JSON.stringify({
      id: row.id,
      schema: row.schema_name,
      table: row.table_name,
      pk: row.pk,
      op: row.op,
      version: row.version,
      actorStaffId: row.actor_staff_id,
      payload: row.payload,
      needsRefetch: row.needs_refetch,
      createdAt: row.created_at,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook ${res.status}: ${text}`);
  }
}

async function drainOnce() {
  if (draining) return;
  draining = true;
  try {
    const rows = await fetchBatch();
    for (const row of rows) {
      try {
        await postEvent(row);
        await markSent(row.id, row.claim_token);
      } catch (error) {
        await markFailed(row.id, row.claim_token, error.message || String(error));
      }
    }
  } finally {
    draining = false;
  }
}

async function start() {
  await Promise.all([listenClient.connect(), workClient.connect()]);
  await listenClient.query('LISTEN realtime_outbox');
  listenClient.on('notification', () => {
    void drainOnce();
  });
  listenClient.on('error', (error) => {
    console.error('[realtime-outbox-relay] listener error:', error);
    process.exit(1);
  });

  console.log('[realtime-outbox-relay] listening on realtime_outbox');
  await drainOnce();
  setInterval(() => {
    void drainOnce();
  }, LOOP_DELAY_MS);
}

start().catch((error) => {
  console.error('[realtime-outbox-relay] fatal:', error);
  process.exit(1);
});
