#!/usr/bin/env node
/**
 * check-mobile-endpoint-integrity.js
 *
 * Verifies response shape for mobile-critical Ops endpoints.
 * Output columns:
 *   endpoint | status | latency_ms | shape_match | diff
 *
 * Usage:
 *   node scripts/check-mobile-endpoint-integrity.js
 *   node scripts/check-mobile-endpoint-integrity.js --base http://localhost:3000
 *   node scripts/check-mobile-endpoint-integrity.js --include-mutations
 */

const DEFAULT_BASE = 'http://localhost:3000';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  return argv[idx + 1] ?? fallback;
};
const has = (name) => argv.includes(name);

const base = String(arg('--base', DEFAULT_BASE)).replace(/\/$/, '');
const includeMutations = has('--include-mutations');

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function validateArrayOfObjects(value, requiredKeys) {
  if (!Array.isArray(value)) {
    return { ok: false, diff: 'expected array' };
  }
  if (value.length === 0) {
    return { ok: true, diff: 'array empty (shape assumed)' };
  }
  const first = asObject(value[0]);
  if (!first) {
    return { ok: false, diff: 'expected array<object>' };
  }
  const missing = requiredKeys.filter((key) => !(key in first));
  if (missing.length > 0) {
    return { ok: false, diff: `missing keys: ${missing.join(', ')}` };
  }
  return { ok: true, diff: '' };
}

function validateObjectWithKeys(value, requiredKeys) {
  const obj = asObject(value);
  if (!obj) return { ok: false, diff: 'expected object' };
  const missing = requiredKeys.filter((key) => !(key in obj));
  if (missing.length > 0) {
    return { ok: false, diff: `missing keys: ${missing.join(', ')}` };
  }
  return { ok: true, diff: '' };
}

function status2xx(status) {
  return status >= 200 && status < 300;
}

async function requestJson(endpoint, method = 'GET', body = null) {
  const url = `${base}${endpoint}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const latency = Date.now() - started;

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      endpoint,
      status: response.status,
      latency,
      data,
      transportError: null,
    };
  } catch (error) {
    return {
      endpoint,
      status: 'ERR',
      latency: Date.now() - started,
      data: null,
      transportError: error?.message || 'request failed',
    };
  }
}

function createCheck({
  endpoint,
  method = 'GET',
  body = null,
  statusCheck = status2xx,
  validate = () => ({ ok: true, diff: '' }),
}) {
  return { endpoint, method, body, statusCheck, validate };
}

const readChecks = [
  createCheck({
    endpoint: '/api/staff?role=technician&active=true',
    validate: (data) => validateArrayOfObjects(data, ['id', 'name']),
  }),
  createCheck({
    endpoint: '/api/tech-logs?techId=1&limit=5',
    validate: (data) => validateArrayOfObjects(data, ['shipping_tracking_number']),
  }),
  createCheck({
    endpoint: '/api/orders/next?techId=1&all=true&outOfStock=false',
    validate: (data) => validateObjectWithKeys(data, ['orders']),
  }),
  createCheck({
    endpoint: '/api/orders/next?techId=1&all=true&outOfStock=true',
    validate: (data) => validateObjectWithKeys(data, ['orders']),
  }),
  createCheck({
    endpoint: '/api/orders',
    validate: (data) => validateObjectWithKeys(data, ['orders']),
  }),
  createCheck({
    endpoint: '/api/shipped',
    validate: (data) => {
      const asObj = asObject(data);
      if (!asObj) return { ok: false, diff: 'expected object' };
      if ('results' in asObj || 'shipped' in asObj) return { ok: true, diff: '' };
      return { ok: false, diff: 'missing keys: results|shipped' };
    },
  }),
  createCheck({
    endpoint: '/api/receiving-logs?limit=10',
    validate: (data) => validateArrayOfObjects(data, ['id']),
  }),
  createCheck({
    endpoint: '/api/receiving-logs/search?q=1Z',
    validate: (data) => validateObjectWithKeys(data, ['results']),
  }),
  createCheck({
    endpoint: '/api/product-manuals',
    validate: (data) => (
      Array.isArray(data)
        ? { ok: true, diff: '' }
        : validateObjectWithKeys(data, ['results'])
    ),
  }),
  createCheck({
    endpoint: '/api/product-manuals/categories',
    validate: (data) => (
      Array.isArray(data)
        ? { ok: true, diff: '' }
        : validateObjectWithKeys(data, ['categories'])
    ),
  }),
];

function tinyJpegDataUri() {
  // 1x1 pixel JPEG
  return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFhUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGy0lICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBIgACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB9gD/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/AV//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAY/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/IV//2gAMAwEAAgADAAAAED//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/EH//2Q==';
}

async function resolveSeedOrder() {
  const candidates = [
    '/api/orders/next?techId=1&all=true&outOfStock=false',
    '/api/orders?includeShipped=true',
    '/api/shipped?limit=50',
  ];

  for (const endpoint of candidates) {
    const res = await requestJson(endpoint, 'GET');
    if (!status2xx(Number(res.status))) continue;
    const payload = res.data;

    const rows = Array.isArray(payload?.orders)
      ? payload.orders
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.shipped)
          ? payload.shipped
          : [];

    const firstWithTracking = rows.find((row) => {
      const tracking = String(
        row?.shipping_tracking_number ??
        row?.tracking ??
        ''
      ).trim();
      return tracking.length >= 8;
    });

    if (firstWithTracking) {
      const tracking = String(firstWithTracking.shipping_tracking_number || firstWithTracking.tracking || '').trim();
      const orderId = String(firstWithTracking.order_id || firstWithTracking.orderId || `INTEGRITY-${Date.now()}`);
      return { tracking, orderId };
    }
  }

  return null;
}

async function runCheck(check) {
  const res = await requestJson(check.endpoint, check.method, check.body);

  if (res.transportError) {
    return {
      endpoint: check.endpoint,
      status: 'ERR',
      latency: res.latency,
      shapeOk: false,
      diff: res.transportError,
    };
  }

  const statusOk = check.statusCheck(res.status, res.data);
  const shape = check.validate(res.data, res.status);
  const shapeOk = statusOk && shape.ok;

  let diff = '';
  if (!statusOk) {
    const errorText = asObject(res.data)?.error ? `: ${asObject(res.data).error}` : '';
    diff = `HTTP ${res.status}${errorText}`;
  } else if (!shape.ok) {
    diff = shape.diff || 'shape mismatch';
  }

  return {
    endpoint: check.endpoint,
    status: res.status,
    latency: res.latency,
    shapeOk,
    diff,
    data: res.data,
  };
}

function formatTable(rows) {
  const headers = ['endpoint', 'status', 'latency_ms', 'shape_match', 'diff'];
  const widths = {
    endpoint: Math.max(headers[0].length, ...rows.map((r) => String(r.endpoint).length)),
    status: Math.max(headers[1].length, ...rows.map((r) => String(r.status).length)),
    latency_ms: Math.max(headers[2].length, ...rows.map((r) => String(r.latency).length)),
    shape_match: headers[3].length,
    diff: Math.max(headers[4].length, ...rows.map((r) => String(r.diff || '').length)),
  };

  const line = `${headers[0].padEnd(widths.endpoint)} | ${headers[1].padEnd(widths.status)} | ${headers[2].padEnd(widths.latency_ms)} | ${headers[3]} | ${headers[4].padEnd(widths.diff)}`;
  const divider = `${'-'.repeat(widths.endpoint)}-+-${'-'.repeat(widths.status)}-+-${'-'.repeat(widths.latency_ms)}-+-${'-'.repeat(widths.shape_match)}-+-${'-'.repeat(widths.diff)}`;

  console.log(line);
  console.log(divider);

  for (const row of rows) {
    const mark = row.shapeOk ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(
      `${String(row.endpoint).padEnd(widths.endpoint)} | ${String(row.status).padEnd(widths.status)} | ${String(row.latency).padEnd(widths.latency_ms)} | ${mark.padEnd(widths.shape_match + 9)} | ${String(row.diff || '').padEnd(widths.diff)}`
    );
  }
}

async function buildMutationChecks() {
  const checks = [
    createCheck({
      endpoint: '/api/scan-tracking',
      method: 'POST',
      body: {
        tracking: `INTEGRITY-NOT-FOUND-${Date.now()}`,
        sourceStation: 'verify',
        staffId: null,
        staffName: null,
        exceptionReason: 'not_found',
      },
      validate: (data) => validateObjectWithKeys(data, ['found']),
    }),
    createCheck({
      endpoint: '/api/tech/scan-tracking',
      method: 'POST',
      body: {
        tracking: `INTEGRITY-NOT-FOUND-${Date.now()}`,
        techId: '1',
      },
      validate: (data) => validateObjectWithKeys(data, ['found']),
    }),
  ];

  const seed = await resolveSeedOrder();
  const seedTracking = seed?.tracking || `INTEGRITY-TRACKING-${Date.now()}`;
  const seedOrderId = seed?.orderId || `INTEGRITY-ORDER-${Date.now()}`;

  checks.push(
    createCheck({
      endpoint: '/api/packing-logs/save-photo',
      method: 'POST',
      body: {
        photo: tinyJpegDataUri(),
        orderId: seedOrderId,
        packerId: 1,
        photoIndex: 0,
      },
      validate: (data) => validateObjectWithKeys(data, ['success', 'path']),
    })
  );

  checks.push(
    createCheck({
      endpoint: '/api/packing-logs/update',
      method: 'POST',
      body: {
        shippingTrackingNumber: seedTracking,
        trackingType: 'orders',
        packDateTime: new Date().toISOString(),
        packedBy: 1,
        packerPhotosUrl: [],
        orderId: seedOrderId,
      },
      statusCheck: (status) => status === 400,
      validate: (data) => validateObjectWithKeys(data, ['error']),
    })
  );

  const serialValue = `INT${Date.now()}`.toUpperCase();
  const allowFbaDuplicates = /^(X0|B0|FBA)/i.test(String(seedTracking).trim());

  checks.push(
    createCheck({
      endpoint: '/api/tech/add-serial',
      method: 'POST',
      body: {
        tracking: seedTracking,
        serial: serialValue,
        techId: '1',
        allowFbaDuplicates,
      },
      validate: (data, status) => {
        const obj = asObject(data);
        if (!obj) return { ok: false, diff: 'expected object' };
        if (status >= 200 && status < 300) {
          if (obj.success === true && Array.isArray(obj.serialNumbers)) return { ok: true, diff: '' };
          return { ok: false, diff: obj.error ? String(obj.error) : 'missing serialNumbers/success' };
        }
        if ('success' in obj && obj.success === false && 'error' in obj) return { ok: true, diff: '' };
        return { ok: false, diff: 'unexpected error payload shape' };
      },
      statusCheck: (status, data) => {
        if (status >= 200 && status < 300) return true;
        const obj = asObject(data);
        return status === 400 || status === 404 ? Boolean(obj && obj.success === false) : false;
      },
    })
  );

  checks.push(
    createCheck({
      endpoint: '/api/tech/undo-last',
      method: 'POST',
      body: {
        tracking: seedTracking,
        techId: '1',
      },
      validate: (data) => {
        const obj = asObject(data);
        if (!obj) return { ok: false, diff: 'expected object' };
        if ('success' in obj) return { ok: true, diff: '' };
        return { ok: false, diff: 'missing success field' };
      },
      statusCheck: (status, data) => {
        const obj = asObject(data);
        if (status >= 200 && status < 300) return Boolean(obj && obj.success === true);
        if (status === 404 || status === 400) return Boolean(obj && obj.success === false);
        return false;
      },
    })
  );

  return {
    checks,
    seed,
  };
}

async function main() {
  console.log(`${CYAN}Mobile Endpoint Integrity Check${RESET}`);
  console.log(`Base URL: ${base}`);
  console.log(`Mode: ${includeMutations ? 'read + mutation checks' : 'read-only checks'}`);
  console.log('');

  const allChecks = [...readChecks];
  let seed = null;

  if (includeMutations) {
    const mutation = await buildMutationChecks();
    allChecks.push(...mutation.checks);
    seed = mutation.seed;
  }

  const rows = [];
  for (const check of allChecks) {
    rows.push(await runCheck(check));
  }

  formatTable(rows);
  console.log('');

  if (includeMutations) {
    if (seed?.tracking) {
      console.log(`${CYAN}Mutation Seed${RESET}: tracking=${seed.tracking} orderId=${seed.orderId}`);
    } else {
      console.log(`${YELLOW}Mutation Seed${RESET}: no seeded order found, fallback tracking values were used.`);
    }
  }

  const failed = rows.filter((row) => !row.shapeOk);
  if (failed.length > 0) {
    console.log(`${RED}FAILED${RESET}: ${failed.length}/${rows.length} endpoints failed shape/status validation.`);
    process.exit(1);
  }

  if (!includeMutations) {
    console.log(`${YELLOW}Note${RESET}: Mutation endpoints were skipped. Re-run with --include-mutations for full coverage.`);
  }

  console.log(`${GREEN}PASS${RESET}: ${rows.length}/${rows.length} endpoints matched expected shape.`);
}

main().catch((error) => {
  console.error(`${RED}Fatal${RESET}:`, error?.message || error);
  process.exit(1);
});
