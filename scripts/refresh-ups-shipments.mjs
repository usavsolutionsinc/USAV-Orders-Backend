#!/usr/bin/env node
/**
 * Force-refresh non-terminal UPS shipments by calling the UPS provider
 * directly and writing results via the shipping repository. Bypasses the
 * cron's `next_check_at` schedule so we can re-pull on demand.
 *
 * Usage:
 *   node scripts/refresh-ups-shipments.mjs           # dry run, lists targets
 *   node scripts/refresh-ups-shipments.mjs --apply   # actually re-poll
 *   node scripts/refresh-ups-shipments.mjs --apply --limit 50  # cap fan-out
 */

import { Pool } from 'pg';

try {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  config({ path: '.env' });
} catch {
  // dotenv optional
}

const APPLY = process.argv.includes('--apply');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX > 0 ? Number(process.argv[LIMIT_IDX + 1]) : 100;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}
if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
  console.error('UPS_CLIENT_ID and UPS_CLIENT_SECRET are required');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Inline minimal UPS client — avoids the TS import overhead. Same auth +
// payload parse contract as src/lib/shipping/providers/ups.ts.
const UPS_AUTH_URL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const UPS_TRACK_URL = 'https://onlinetools.ups.com/api/track/v1/details';

let tokenCache = null;
async function getToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const creds = Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(UPS_AUTH_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`UPS auth failed: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 14400) * 1000 };
  return tokenCache.token;
}

const TYPE_MAP = {
  M: 'LABEL_CREATED', P: 'ACCEPTED', OR: 'ACCEPTED', I: 'IN_TRANSIT',
  OT: 'OUT_FOR_DELIVERY', D: 'DELIVERED', X: 'EXCEPTION', RS: 'RETURNED', NA: 'UNKNOWN',
};

/**
 * UPS sometimes returns `currentStatus` without a `type` field (only
 * description + code). Mirrors the production text-matcher fallback in
 * src/lib/shipping/normalize.ts so we don't drop those into UNKNOWN.
 */
function normalizeByText(description) {
  const text = String(description || '').toUpperCase();
  if (!text) return 'UNKNOWN';
  if (text.includes('DELIVERED')) return 'DELIVERED';
  if (text.includes('OUT FOR DELIVERY') || text.includes('LOADED ON DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (text.includes('RETURN')) return 'RETURNED';
  if (text.includes('EXCEPTION') || text.includes('DELAY') || text.includes('HOLD')) return 'EXCEPTION';
  if (text.includes('PICKUP') || text.includes('PICKED UP') || text.includes('ORIGIN SCAN') || text.includes('ACCEPTED')) return 'ACCEPTED';
  if (text.includes('IN TRANSIT') || text.includes('ON THE WAY') || text.includes('ARRIVED') || text.includes('DEPARTED') || text.includes('PROCESSING')) return 'IN_TRANSIT';
  if (text.includes('LABEL CREATED') || text.includes('SHIPMENT READY') || text.includes('SHIPPER CREATED')) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

function normalize(type, description) {
  const t = String(type ?? '').toUpperCase();
  if (t && TYPE_MAP[t]) return TYPE_MAP[t];
  return normalizeByText(description);
}

async function trackOne(tracking) {
  const token = await getToken();
  const res = await fetch(`${UPS_TRACK_URL}/${encodeURIComponent(tracking)}?locale=en_US`, {
    headers: { Authorization: `Bearer ${token}`, transId: crypto.randomUUID(), transactionSrc: 'usav-refresh-script' },
  });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

async function main() {
  console.log(APPLY ? `APPLY — re-polling up to ${LIMIT} UPS shipments` : 'DRY RUN');

  const due = await pool.query(`
    SELECT id, tracking_number_normalized, latest_status_category, last_error_code
      FROM shipping_tracking_numbers
     WHERE carrier = 'UPS'
       AND is_terminal = false
       AND (latest_status_category IS NULL
            OR latest_status_category IN ('UNKNOWN','LABEL_CREATED','ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','EXCEPTION'))
     ORDER BY COALESCE(last_checked_at, '1970-01-01'::timestamptz) ASC
     LIMIT $1
  `, [LIMIT]);

  console.log(`targets: ${due.rows.length}`);
  if (!APPLY) {
    due.rows.slice(0, 5).forEach((r) => console.log(' ', r));
    if (due.rows.length > 5) console.log(`  …and ${due.rows.length - 5} more.`);
    await pool.end();
    return;
  }

  let updated = 0, delivered = 0, errors = 0;
  for (const row of due.rows) {
    try {
      const { status, body } = await trackOne(row.tracking_number_normalized);
      if (status !== 200 || typeof body === 'string') {
        // Track failure but keep moving.
        await pool.query(
          `UPDATE shipping_tracking_numbers
              SET consecutive_error_count = consecutive_error_count + 1,
                  check_attempt_count     = check_attempt_count + 1,
                  last_checked_at         = now(),
                  last_error_code         = $1,
                  last_error_message      = $2,
                  updated_at              = now()
            WHERE id = $3`,
          [status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR', String(body).slice(0, 1000), row.id],
        );
        errors++;
        continue;
      }
      const shipment = body?.trackResponse?.shipment?.[0] ?? body?.trackResponse?.shipment;
      const pkg = Array.isArray(shipment?.package) ? shipment.package[0] : shipment?.package;
      if (!pkg) { errors++; continue; }
      const cur = pkg.currentStatus ?? pkg.activity?.[0]?.status ?? {};
      const cat = normalize(cur.type, cur.description);
      const isDelivered = cat === 'DELIVERED';
      const deliveredAt = isDelivered
        ? (() => {
            const act = (pkg.activity ?? []).find((a) => normalize(a?.status?.type, a?.status?.description) === 'DELIVERED');
            if (!act?.date || act.date.length < 8) return null;
            const y = act.date.slice(0, 4), m = act.date.slice(4, 6), d = act.date.slice(6, 8);
            const h = act.time?.slice(0, 2) ?? '00', mn = act.time?.slice(2, 4) ?? '00', s = act.time?.slice(4, 6) ?? '00';
            return `${y}-${m}-${d}T${h}:${mn}:${s}Z`;
          })()
        : null;

      await pool.query(
        `UPDATE shipping_tracking_numbers
            SET latest_status_category = $1,
                latest_status_code     = $2,
                latest_status_label    = $3,
                latest_status_description = $4,
                is_label_created       = ($1 IN ('LABEL_CREATED','ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURNED')),
                is_carrier_accepted    = ($1 IN ('ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED')),
                is_in_transit          = ($1 IN ('IN_TRANSIT','OUT_FOR_DELIVERY')),
                is_out_for_delivery    = ($1 = 'OUT_FOR_DELIVERY'),
                is_delivered           = ($1 = 'DELIVERED'),
                is_terminal            = ($1 IN ('DELIVERED','RETURNED')),
                has_exception          = ($1 = 'EXCEPTION'),
                delivered_at           = COALESCE($5::timestamptz, delivered_at),
                latest_event_at        = now(),
                last_checked_at        = now(),
                consecutive_error_count = 0,
                check_attempt_count    = check_attempt_count + 1,
                last_error_code        = NULL,
                last_error_message     = NULL,
                next_check_at          = CASE WHEN $1 IN ('DELIVERED','RETURNED') THEN NULL
                                              ELSE now() + INTERVAL '2 hours' END,
                updated_at             = now()
          WHERE id = $6`,
        [cat, cur.code ?? null, cur.type ?? null, cur.description ?? null, deliveredAt, row.id],
      );
      updated++;
      if (isDelivered) delivered++;
    } catch (err) {
      console.warn(`  shipment ${row.id} failed: ${err.message}`);
      errors++;
    }
  }
  console.log(`done — updated: ${updated}, newly delivered: ${delivered}, errors: ${errors}`);
  await pool.end();
}

main().catch((err) => {
  console.error('refresh failed:', err);
  process.exit(1);
});
