require('dotenv').config({ path: '.env', quiet: true });

const { Client } = require('pg');

const UPS_AUTH_URL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const UPS_TRACK_URL = 'https://onlinetools.ups.com/api/track/v1/details';

function normalizeTrackingNumber(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeUPSStatus(statusType) {
  const statusMap = {
    M: 'LABEL_CREATED',
    P: 'ACCEPTED',
    OR: 'ACCEPTED',
    I: 'IN_TRANSIT',
    OT: 'OUT_FOR_DELIVERY',
    D: 'DELIVERED',
    X: 'EXCEPTION',
    RS: 'RETURNED',
    NA: 'UNKNOWN',
  };

  if (!statusType) return 'UNKNOWN';
  return statusMap[String(statusType).toUpperCase()] || 'UNKNOWN';
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

function parseUPSDate(date, time) {
  if (!date || String(date).length < 8) return null;
  const y = String(date).slice(0, 4);
  const m = String(date).slice(4, 6);
  const d = String(date).slice(6, 8);
  const h = String(time || '000000').slice(0, 2) || '00';
  const min = String(time || '000000').slice(2, 4) || '00';
  const s = String(time || '000000').slice(4, 6) || '00';
  const parsed = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

async function getAccessToken() {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing UPS credentials. Set UPS_CLIENT_ID and UPS_CLIENT_SECRET.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(UPS_AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UPS auth failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchTracking(token, trackingNumber) {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const res = await fetch(
    `${UPS_TRACK_URL}/${encodeURIComponent(normalized)}?locale=en_US&returnSignature=false`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        transId: crypto.randomUUID(),
        transactionSrc: 'usav-orders-backfill',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UPS track failed for ${normalized}: ${res.status} ${body}`);
  }

  const payload = await res.json();
  const shipment = Array.isArray(payload?.trackResponse?.shipment)
    ? payload.trackResponse.shipment[0]
    : payload?.trackResponse?.shipment;
  const pkg = Array.isArray(shipment?.package) ? shipment.package[0] : shipment?.package;

  if (!shipment || !pkg) {
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
      metadata: {
        source: 'ups-track-v1',
      },
    };
  }

  const currentStatus = pkg?.currentStatus ?? pkg?.activity?.[0]?.status;
  const activities = Array.isArray(pkg?.activity) ? pkg.activity : [];
  const events = activities.map((act) => {
    const status = act?.status ?? {};
    const addr = act?.location?.address ?? {};
    const occurredAt = parseUPSDate(act?.date, act?.time);
    return {
      externalEventId: [status.code ?? null, occurredAt ?? null, addr.city ?? null].filter(Boolean).join(':') || null,
      externalStatusCode: status.code ?? null,
      externalStatusLabel: status.type ?? null,
      externalStatusDescription: status.description ?? null,
      normalizedStatusCategory: normalizeUPSStatus(status.type),
      eventOccurredAt: occurredAt,
      city: addr.city ?? null,
      state: addr.stateProvince ?? null,
      postalCode: addr.postalCode ?? null,
      countryCode: addr.countryCode ?? null,
      signedBy: pkg?.deliveryInformation?.receivedBy ?? null,
      exceptionCode: null,
      exceptionDescription: null,
      payload: act,
    };
  });

  const deliveredEvent = events.find((event) => event.normalizedStatusCategory === 'DELIVERED') || null;
  const latestEventAt = events.map((event) => event.eventOccurredAt).filter(Boolean).sort().reverse()[0] || null;

  return {
    normalized,
    payload,
    events,
    latestStatusCategory: normalizeUPSStatus(currentStatus?.type),
    latestStatusCode: currentStatus?.code ?? null,
    latestStatusLabel: currentStatus?.type ?? null,
    latestStatusDescription: currentStatus?.description ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt || null,
    metadata: {
      source: 'ups-track-v1',
      service: firstValue(
        shipment?.service?.description,
        shipment?.service?.code,
        pkg?.service?.description,
        pkg?.service?.code
      ),
      packageCount: Array.isArray(shipment?.package) ? shipment.package.length : null,
      referenceNumber: firstValue(
        pkg?.referenceNumber?.[0]?.number,
        shipment?.referenceNumber?.[0]?.number
      ),
      deliveryDate: Array.isArray(pkg?.deliveryDate) ? pkg.deliveryDate[0] : (pkg?.deliveryDate ?? null),
      signedBy: firstValue(
        pkg?.deliveryInformation?.receivedBy,
        payload?.trackResponse?.shipment?.[0]?.deliveryDate?.[0]?.receivedByName
      ),
      latestLocation: events[0]
        ? {
            city: events[0].city || null,
            state: events[0].state || null,
            postalCode: events[0].postalCode || null,
            countryCode: events[0].countryCode || null,
          }
        : null,
      trackingUrl: `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(normalized)}&loc=en_US&requester=ST/trackdetails`,
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
         $1, 'UPS', $2, $3, $4, $5, $6, $7,
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

  const where = [`UPPER(carrier) = 'UPS'`];
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
  console.log(`UPS rows selected: ${rows.length}`);

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
