require('dotenv').config({ path: '.env', quiet: true });

const { Client } = require('pg');

const FEDEX_BASE_URL =
  process.env.FEDEX_ENV === 'production'
    ? 'https://apis.fedex.com'
    : 'https://apis-sandbox.fedex.com';
const FEDEX_AUTH_URL = `${FEDEX_BASE_URL}/oauth/token`;
const FEDEX_TRACK_URL = `${FEDEX_BASE_URL}/track/v1/trackingnumbers`;

function normalizeTrackingNumber(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeFedExStatus(eventType, description) {
  const map = {
    OC: 'LABEL_CREATED',
    PU: 'ACCEPTED',
    AO: 'ACCEPTED',
    AR: 'IN_TRANSIT',
    AF: 'IN_TRANSIT',
    IT: 'IN_TRANSIT',
    OD: 'OUT_FOR_DELIVERY',
    DL: 'DELIVERED',
    DE: 'EXCEPTION',
    HL: 'EXCEPTION',
    RS: 'RETURNED',
    CA: 'RETURNED',
  };
  if (eventType && map[String(eventType).toUpperCase()]) return map[String(eventType).toUpperCase()];
  const text = String(description || '').toUpperCase();
  if (text.includes('DELIVERED')) return 'DELIVERED';
  if (text.includes('OUT FOR DELIVERY') || text.includes('ON FEDEX VEHICLE FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (text.includes('PICKED UP') || text.includes('ACCEPTED')) return 'ACCEPTED';
  if (text.includes('RETURN')) return 'RETURNED';
  if (text.includes('EXCEPTION') || text.includes('DELAY') || text.includes('HELD')) return 'EXCEPTION';
  if (text.includes('IN TRANSIT') || text.includes('AT LOCAL FEDEX FACILITY') || text.includes('ARRIVED')) return 'IN_TRANSIT';
  if (text.includes('LABEL CREATED') || text.includes('SHIPMENT INFORMATION SENT')) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

function computeNextCheckAt(status) {
  if (status === 'DELIVERED') return null;
  const baseOffsets = {
    LABEL_CREATED: 8 * 60 * 60 * 1000,
    ACCEPTED: 4 * 60 * 60 * 1000,
    IN_TRANSIT: 2 * 60 * 60 * 1000,
    OUT_FOR_DELIVERY: 45 * 60 * 1000,
    DELIVERED: 0,
    EXCEPTION: 3 * 60 * 60 * 1000,
    RETURNED: 12 * 60 * 60 * 1000,
    UNKNOWN: 6 * 60 * 60 * 1000,
  };
  return new Date(Date.now() + (baseOffsets[status] || baseOffsets.UNKNOWN)).toISOString();
}

let cachedToken = null;
let tokenExpiresAt = null;

async function getAccessToken() {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) return cachedToken;

  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET.');
  }

  const res = await fetch(FEDEX_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FedEx auth failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 300) * 1000;
  return cachedToken;
}

async function fetchTracking(trackingNumber) {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const token = await getAccessToken();

  const res = await fetch(FEDEX_TRACK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: normalized } }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FedEx track failed for ${normalized}: ${res.status} ${body}`);
  }

  const payload = await res.json();
  const trackResult = payload?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!trackResult) {
    return {
      normalized,
      payload,
      events: [],
      latestStatusCategory: 'UNKNOWN',
      latestStatusCode: null,
      latestStatusLabel: null,
      latestStatusDescription: null,
      latestEventAt: null,
      deliveredAt: null,
      metadata: { source: 'fedex-track-v1' },
    };
  }

  if (trackResult.error) {
    throw new Error(trackResult.error.message || 'FedEx tracking error');
  }

  const latestStatus = trackResult.latestStatusDetail ?? {};
  const events = (trackResult.scanEvents || []).map((scan) => ({
    externalEventId: scan?.eventType && scan?.date ? `${scan.eventType}:${scan.date}` : null,
    externalStatusCode: scan?.eventType ?? null,
    externalStatusLabel: scan?.derivedStatus ?? null,
    externalStatusDescription: scan?.eventDescription ?? null,
    normalizedStatusCategory: normalizeFedExStatus(scan?.eventType ?? scan?.derivedStatusCode, scan?.eventDescription ?? scan?.derivedStatus),
    eventOccurredAt: scan?.date ? new Date(scan.date).toISOString() : null,
    city: scan?.scanLocation?.city ?? null,
    state: scan?.scanLocation?.stateOrProvinceCode ?? null,
    postalCode: scan?.scanLocation?.postalCode ?? null,
    countryCode: scan?.scanLocation?.countryCode ?? null,
    signedBy: null,
    exceptionCode: scan?.exceptionCode ?? null,
    exceptionDescription: scan?.exceptionDescription ?? null,
    payload: scan,
  }));

  const deliveryDateEntry = (trackResult.dateAndTimes || []).find((d) => d?.type === 'ACTUAL_DELIVERY');
  const deliveredAt = deliveryDateEntry?.dateTime ? new Date(deliveryDateEntry.dateTime).toISOString() : null;
  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] || null;

  return {
    normalized,
    payload,
    events,
    latestStatusCategory: normalizeFedExStatus(latestStatus.code ?? latestStatus.derivedCode, latestStatus.description ?? latestStatus.statusByLocale),
    latestStatusCode: latestStatus.code ?? latestStatus.derivedCode ?? null,
    latestStatusLabel: latestStatus.statusByLocale ?? null,
    latestStatusDescription: latestStatus.description ?? null,
    latestEventAt,
    deliveredAt,
    metadata: {
      source: 'fedex-track-v1',
      environment: process.env.FEDEX_ENV === 'production' ? 'production' : 'sandbox',
      service: trackResult.serviceDetail?.description ?? trackResult.serviceType ?? null,
      estimatedDelivery:
        trackResult.estimatedDeliveryTimeWindow?.window?.ends ??
        trackResult.estimatedDeliveryTimeWindow?.window?.begins ??
        null,
      latestLocation: latestStatus.scanLocation
        ? {
            city: latestStatus.scanLocation.city ?? null,
            state: latestStatus.scanLocation.stateOrProvinceCode ?? null,
            postalCode: latestStatus.scanLocation.postalCode ?? null,
            countryCode: latestStatus.scanLocation.countryCode ?? null,
          }
        : null,
      trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(normalized)}`,
    },
  };
}

async function upsertEvents(client, shipmentId, trackingNumberNormalized, events) {
  let inserted = 0;
  for (const ev of events) {
    const result = await client.query(
      `INSERT INTO shipment_tracking_events (
         shipment_id, carrier, tracking_number_normalized,
         external_event_id, external_status_code, external_status_label,
         external_status_description, normalized_status_category,
         event_occurred_at, event_city, event_state, event_postal_code,
         event_country_code, signed_by, exception_code, exception_description,
         payload
       ) VALUES (
         $1, 'FEDEX', $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
       )
       ON CONFLICT (
         shipment_id,
         COALESCE(external_event_id, ''),
         COALESCE(external_status_code, ''),
         COALESCE(event_occurred_at, 'epoch'::timestamptz)
       ) DO NOTHING`,
      [
        shipmentId, trackingNumberNormalized, ev.externalEventId, ev.externalStatusCode, ev.externalStatusLabel,
        ev.externalStatusDescription, ev.normalizedStatusCategory, ev.eventOccurredAt, ev.city, ev.state,
        ev.postalCode, ev.countryCode, ev.signedBy, ev.exceptionCode, ev.exceptionDescription,
        JSON.stringify(ev.payload || {}),
      ]
    );
    inserted += result.rowCount || 0;
  }
  return inserted;
}

async function updateShipment(client, shipmentId, data) {
  const status = data.latestStatusCategory;
  const isTerminal = status === 'DELIVERED' || status === 'RETURNED';
  await client.query(
    `UPDATE shipping_tracking_numbers SET
       latest_status_code = $1, latest_status_label = $2, latest_status_description = $3, latest_status_category = $4,
       is_label_created = (is_label_created OR $5::boolean), is_carrier_accepted = (is_carrier_accepted OR $6::boolean),
       is_in_transit = (is_in_transit OR $7::boolean), is_out_for_delivery = (is_out_for_delivery OR $8::boolean),
       is_delivered = $9::boolean, has_exception = $10::boolean, is_terminal = $11::boolean,
       label_created_at = CASE WHEN $12::boolean AND label_created_at IS NULL THEN now() ELSE label_created_at END,
       carrier_accepted_at = CASE WHEN $13::boolean AND carrier_accepted_at IS NULL THEN now() ELSE carrier_accepted_at END,
       first_in_transit_at = CASE WHEN $14::boolean AND first_in_transit_at IS NULL THEN now() ELSE first_in_transit_at END,
       out_for_delivery_at = CASE WHEN $15::boolean THEN now() ELSE out_for_delivery_at END,
       delivered_at = CASE WHEN $16::boolean AND delivered_at IS NULL THEN COALESCE($17::timestamptz, now()) ELSE delivered_at END,
       exception_at = CASE WHEN $18::boolean THEN now() ELSE exception_at END,
       latest_event_at = COALESCE($19::timestamptz, latest_event_at), last_checked_at = now(), next_check_at = $20::timestamptz,
       check_attempt_count = check_attempt_count + 1, consecutive_error_count = 0, last_error_code = NULL, last_error_message = NULL,
       latest_payload = $21::jsonb, metadata = COALESCE(metadata, '{}'::jsonb) || $22::jsonb, updated_at = now()
     WHERE id = $23`,
    [
      data.latestStatusCode, data.latestStatusLabel, data.latestStatusDescription, status,
      status === 'LABEL_CREATED', status === 'ACCEPTED', status === 'IN_TRANSIT', status === 'OUT_FOR_DELIVERY',
      status === 'DELIVERED', status === 'EXCEPTION', isTerminal,
      status === 'LABEL_CREATED', status === 'ACCEPTED', status === 'IN_TRANSIT', status === 'OUT_FOR_DELIVERY',
      status === 'DELIVERED', data.deliveredAt, status === 'EXCEPTION', data.latestEventAt,
      isTerminal ? null : computeNextCheckAt(status), JSON.stringify(data.payload || {}),
      JSON.stringify(data.metadata || {}), shipmentId,
    ]
  );
}

function parseArgs(argv) {
  const args = { limit: null, id: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1] || 0) || null;
    if (argv[i] === '--id') args.id = Number(argv[i + 1] || 0) || null;
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const where = [`UPPER(carrier) = 'FEDEX'`];
  const params = [];
  if (args.id) {
    params.push(args.id);
    where.push(`id = $${params.length}`);
  }
  let sql = `SELECT id, tracking_number_raw, tracking_number_normalized FROM shipping_tracking_numbers WHERE ${where.join(' AND ')} ORDER BY id ASC`;
  if (args.limit) {
    params.push(args.limit);
    sql += ` LIMIT $${params.length}`;
  }
  const rows = (await client.query(sql, params)).rows;
  console.log(`FEDEX rows selected: ${rows.length}`);

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const tracking = row.tracking_number_normalized || row.tracking_number_raw;
    try {
      const data = await fetchTracking(tracking);
      if (args.dryRun) {
        console.log(JSON.stringify({
          shipmentId: row.id,
          tracking,
          latestStatusCategory: data.latestStatusCategory,
          latestStatusDescription: data.latestStatusDescription,
          latestEventAt: data.latestEventAt,
          events: data.events.length,
        }));
      } else {
        await client.query('BEGIN');
        await upsertEvents(client, row.id, data.normalized, data.events);
        await updateShipment(client, row.id, data);
        await client.query('COMMIT');
        console.log(`Updated shipment ${row.id} (${tracking}) -> ${data.latestStatusCategory}`);
      }
      updated += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      failed += 1;
      console.error(`Failed shipment ${row.id} (${tracking}): ${error.message || error}`);
    }
  }
  await client.end();
  console.log(JSON.stringify({ updated, failed }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
