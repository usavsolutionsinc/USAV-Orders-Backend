require('dotenv').config({ path: '.env', quiet: true });

const { Client } = require('pg');

const USPS_AUTH_URL = 'https://apis.usps.com/oauth2/v3/token';
const USPS_TRACK_URL = 'https://apis.usps.com/tracking/v3/tracking';

function normalizeTrackingNumber(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeUSPSStatus(statusCategory, eventText) {
  const USPS_CATEGORY_MAP = {
    DELIVERED: 'DELIVERED',
    IN_TRANSIT: 'IN_TRANSIT',
    ACCEPTANCE: 'ACCEPTED',
    ACCEPTED: 'ACCEPTED',
    PICKED_UP: 'ACCEPTED',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    RETURN_TO_SENDER: 'RETURNED',
    RETURNED_TO_SENDER: 'RETURNED',
    EXCEPTION: 'EXCEPTION',
    ALERT: 'EXCEPTION',
    UNDELIVERABLE: 'EXCEPTION',
    PRE_SHIPMENT: 'LABEL_CREATED',
    LABEL_CREATED: 'LABEL_CREATED',
  };

  if (statusCategory) {
    const key = String(statusCategory).toUpperCase().replace(/[\s-]/g, '_');
    if (USPS_CATEGORY_MAP[key]) return USPS_CATEGORY_MAP[key];
  }

  const event = String(eventText || '').toUpperCase();
  if (event.includes('DELIVERED')) return 'DELIVERED';
  if (event.includes('OUT FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (
    event.includes('ACCEPTED') ||
    event.includes('PICKED UP') ||
    event.includes('ACCEPTANCE') ||
    event.includes('USPS IN POSSESSION')
  ) return 'ACCEPTED';
  if (event.includes('RETURN')) return 'RETURNED';
  if (
    event.includes('EXCEPTION') ||
    event.includes('ALERT') ||
    event.includes('UNDELIVERABLE') ||
    event.includes('FAILED ATTEMPT')
  ) return 'EXCEPTION';
  if (
    event.includes('IN TRANSIT') ||
    event.includes('DEPARTED') ||
    event.includes('ARRIVED') ||
    event.includes('PROCESSED') ||
    event.includes('SORTING')
  ) return 'IN_TRANSIT';
  if (
    event.includes('LABEL') ||
    event.includes('PRE-SHIPMENT') ||
    event.includes('SHIPPING LABEL') ||
    event.includes('SHIPPING INFO')
  ) return 'LABEL_CREATED';
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

function parseUSPSDate(eventDate, eventTime) {
  if (!eventDate) return null;
  const combined = eventTime ? `${eventDate} ${eventTime}` : eventDate;
  const parsed = new Date(combined);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseUSPSEvent(raw) {
  const eventText = raw?.event ?? raw?.Event ?? '';
  const statusCategory = raw?.statusCategory ?? raw?.StatusCategory ?? null;
  const eventCode = raw?.eventCode ?? raw?.EventCode ?? null;
  const occurredAt = parseUSPSDate(
    raw?.eventDate ?? raw?.EventDate ?? '',
    raw?.eventTime ?? raw?.EventTime ?? ''
  );

  return {
    externalEventId: eventCode ? `${eventCode}:${occurredAt || 'x'}` : null,
    externalStatusCode: eventCode || null,
    externalStatusLabel: statusCategory || null,
    externalStatusDescription: eventText || null,
    normalizedStatusCategory: normalizeUSPSStatus(statusCategory, eventText),
    eventOccurredAt: occurredAt,
    city: raw?.eventCity ?? raw?.EventCity ?? null,
    state: raw?.eventState ?? raw?.EventState ?? null,
    postalCode: raw?.eventZIPCode ?? raw?.EventZIPCode ?? null,
    countryCode: raw?.eventCountry ?? raw?.EventCountry ?? null,
    signedBy: raw?.name ?? raw?.Name ?? null,
    exceptionCode: null,
    exceptionDescription: null,
    payload: raw,
  };
}

async function getAccessToken() {
  const clientId =
    process.env.CONSUMER_KEY ||
    process.env.USPS_CONSUMER_KEY ||
    process.env.USPS_CLIENT_ID;
  const clientSecret =
    process.env.CONSUMER_SECRET ||
    process.env.USPS_CONSUMER_SECRET ||
    process.env.USPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing USPS credentials. Set CONSUMER_KEY and CONSUMER_SECRET.');
  }

  const res = await fetch(USPS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`USPS auth failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchTracking(token, trackingNumber) {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const res = await fetch(`${USPS_TRACK_URL}/${encodeURIComponent(normalized)}?expand=DETAIL`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`USPS track failed for ${normalized}: ${res.status} ${body}`);
  }

  const payload = await res.json();
  const summary = payload?.trackSummary ?? payload?.TrackSummary ?? null;
  const details = payload?.trackDetail ?? payload?.TrackDetail ?? [];
  const allRaw = summary ? [summary, ...details] : details;
  const events = allRaw.map(parseUSPSEvent);
  const deliveredEvent = events.find((event) => event.normalizedStatusCategory === 'DELIVERED') || null;
  const latestEventAt = events.map((event) => event.eventOccurredAt).filter(Boolean).sort().reverse()[0] || null;
  const topStatusCategory = payload?.statusCategory ?? payload?.StatusCategory ?? null;
  const latestStatusCategory = normalizeUSPSStatus(topStatusCategory, summary?.event ?? summary?.Event ?? null);

  return {
    normalized,
    payload,
    summary,
    events,
    latestStatusCategory,
    latestStatusCode: summary?.eventCode ?? summary?.EventCode ?? null,
    latestStatusLabel: topStatusCategory || null,
    latestStatusDescription: summary?.event ?? summary?.Event ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt || null,
    metadata: {
      source: 'usps-tracking-v3',
      service: payload?.mailClass ?? payload?.MailClass ?? summary?.mailClass ?? summary?.MailClass ?? null,
      statusCategory: topStatusCategory || null,
      expectedDeliveryDate:
        payload?.expectedDeliveryDate ??
        payload?.ExpectedDeliveryDate ??
        summary?.expectedDeliveryDate ??
        summary?.ExpectedDeliveryDate ??
        null,
      latestLocation: events[0]
        ? {
            city: events[0].city || null,
            state: events[0].state || null,
            postalCode: events[0].postalCode || null,
            countryCode: events[0].countryCode || null,
          }
        : null,
      signedBy: events[0]?.signedBy || null,
      trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(normalized)}`,
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
         $1, 'USPS', $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
       )
       ON CONFLICT (
         shipment_id,
         COALESCE(external_event_id, ''),
         COALESCE(external_status_code, ''),
         COALESCE(event_occurred_at, 'epoch'::timestamptz)
       ) DO NOTHING`,
      [
        shipmentId,
        trackingNumberNormalized,
        ev.externalEventId,
        ev.externalStatusCode,
        ev.externalStatusLabel,
        ev.externalStatusDescription,
        ev.normalizedStatusCategory,
        ev.eventOccurredAt,
        ev.city,
        ev.state,
        ev.postalCode,
        ev.countryCode,
        ev.signedBy,
        ev.exceptionCode,
        ev.exceptionDescription,
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
       latest_status_code        = $1,
       latest_status_label       = $2,
       latest_status_description = $3,
       latest_status_category    = $4,
       is_label_created          = (is_label_created OR $5::boolean),
       is_carrier_accepted       = (is_carrier_accepted OR $6::boolean),
       is_in_transit             = (is_in_transit OR $7::boolean),
       is_out_for_delivery       = (is_out_for_delivery OR $8::boolean),
       is_delivered              = $9::boolean,
       has_exception             = $10::boolean,
       is_terminal               = $11::boolean,
       label_created_at          = CASE WHEN $12::boolean AND label_created_at IS NULL THEN now() ELSE label_created_at END,
       carrier_accepted_at       = CASE WHEN $13::boolean AND carrier_accepted_at IS NULL THEN now() ELSE carrier_accepted_at END,
       first_in_transit_at       = CASE WHEN $14::boolean AND first_in_transit_at IS NULL THEN now() ELSE first_in_transit_at END,
       out_for_delivery_at       = CASE WHEN $15::boolean THEN now() ELSE out_for_delivery_at END,
       delivered_at              = CASE WHEN $16::boolean AND delivered_at IS NULL THEN COALESCE($17::timestamptz, now()) ELSE delivered_at END,
       exception_at              = CASE WHEN $18::boolean THEN now() ELSE exception_at END,
       latest_event_at           = COALESCE($19::timestamptz, latest_event_at),
       last_checked_at           = now(),
       next_check_at             = $20::timestamptz,
       check_attempt_count       = check_attempt_count + 1,
       consecutive_error_count   = 0,
       last_error_code           = NULL,
       last_error_message        = NULL,
       latest_payload            = $21::jsonb,
       metadata                  = COALESCE(metadata, '{}'::jsonb) || $22::jsonb,
       updated_at                = now()
     WHERE id = $23`,
    [
      data.latestStatusCode,
      data.latestStatusLabel,
      data.latestStatusDescription,
      status,
      status === 'LABEL_CREATED',
      status === 'ACCEPTED',
      status === 'IN_TRANSIT',
      status === 'OUT_FOR_DELIVERY',
      status === 'DELIVERED',
      status === 'EXCEPTION',
      isTerminal,
      status === 'LABEL_CREATED',
      status === 'ACCEPTED',
      status === 'IN_TRANSIT',
      status === 'OUT_FOR_DELIVERY',
      status === 'DELIVERED',
      data.deliveredAt,
      status === 'EXCEPTION',
      data.latestEventAt,
      isTerminal ? null : computeNextCheckAt(status),
      JSON.stringify(data.payload || {}),
      JSON.stringify(data.metadata || {}),
      shipmentId,
    ]
  );
}

function parseArgs(argv) {
  const args = { limit: null, id: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number(argv[i + 1] || 0) || null;
    if (arg === '--id') args.id = Number(argv[i + 1] || 0) || null;
    if (arg === '--dry-run') args.dryRun = true;
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
  const token = await getAccessToken();

  const where = [`UPPER(carrier) = 'USPS'`];
  const params = [];
  if (args.id) {
    params.push(args.id);
    where.push(`id = $${params.length}`);
  }

  let sql =
    `SELECT id, tracking_number_raw, tracking_number_normalized
       FROM shipping_tracking_numbers
      WHERE ${where.join(' AND ')}
      ORDER BY id ASC`;

  if (args.limit) {
    params.push(args.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const rows = (await client.query(sql, params)).rows;
  console.log(`USPS rows selected: ${rows.length}`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const tracking = row.tracking_number_normalized || row.tracking_number_raw;
    try {
      const data = await fetchTracking(token, tracking);
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
