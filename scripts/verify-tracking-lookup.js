/**
 * verify-tracking-lookup.js
 *
 * Diagnostic script that verifies a tracking number can be found by the
 * three lookup paths used in /api/tech/scan-tracking and
 * /api/packing-logs.  Surfaces the most common causes of "order in system
 * but not found" errors.
 *
 * Usage:
 *   node scripts/verify-tracking-lookup.js <TRACKING_NUMBER>
 *   node scripts/verify-tracking-lookup.js <TRACKING_NUMBER> --base http://localhost:3000
 *
 * The script:
 *   1. Normalises the tracking number exactly as the API does
 *   2. Queries the live /api/debug-tracking endpoint (if available)
 *   3. Falls back to direct DB queries via the /api/orders endpoint
 *   4. Checks detectCarrier compatibility
 *   5. Reports all findings with a pass/fail summary
 */

'use strict';

const BASE = (() => {
  const idx = process.argv.indexOf('--base');
  return idx !== -1 ? process.argv[idx + 1] : 'https://usav-orders-backend.vercel.app';
})();

const raw = process.argv.find((a, i) => i >= 2 && !a.startsWith('--') && process.argv[i - 1] !== '--base');
if (!raw) {
  console.error('Usage: node scripts/verify-tracking-lookup.js <TRACKING_NUMBER> [--base URL]');
  process.exit(1);
}

// ── Normalisation helpers (mirrors src/lib/tracking-format.ts) ─────────────

function normalizeCanonical(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeKey18(input) {
  const n = normalizeCanonical(input);
  return n.length > 18 ? n.slice(-18) : n;
}

function normalizeDigitsLast8(input) {
  const d = String(input || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : d;
}

// ── Carrier detection (mirrors src/lib/shipping/normalize.ts) ──────────────

function detectCarrier(norm) {
  if (/^1Z[A-Z0-9]{16}$/.test(norm)) return 'UPS';
  if (/^\d{12}$/.test(norm))          return 'FEDEX';
  if (/^\d{15}$/.test(norm))          return 'FEDEX';
  if (/^\d{20}$/.test(norm))          return 'FEDEX';
  if (/^9\d{15,21}$/.test(norm))      return 'USPS';
  if (/^\d{20,22}$/.test(norm))       return 'USPS';
  return null;
}

// ── detectType (mirrors src/hooks/useStationTestingController.ts) ──────────

function detectType(val) {
  const input = val.trim();
  if (!input) return 'SERIAL';
  if (input.includes(':')) return 'SKU';
  if (/^(X0|B0)/i.test(input)) return 'FNSKU';
  if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
  const norm = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^1Z[A-Z0-9]{16}$/.test(norm))  return 'TRACKING';
  if (/^9\d{15,21}$/.test(norm))       return 'TRACKING';
  if (/^(42|420|93|96|94|92|JJD|JD|JVGL)/i.test(norm)) return 'TRACKING';
  if (/^\d{12}$/.test(norm) || /^\d{15}$/.test(norm)) return 'TRACKING';
  if (/^\d{20,22}$/.test(norm))        return 'TRACKING';
  if (/^TBA\d{9,}$/.test(norm))        return 'TRACKING';
  return 'SERIAL';
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const PASS = '\x1b[32m✔\x1b[0m';
  const FAIL = '\x1b[31m✘\x1b[0m';
  const WARN = '\x1b[33m⚠\x1b[0m';
  const INFO = '\x1b[36mℹ\x1b[0m';

  console.log('\n════════════════════════════════════════════════════════');
  console.log(' USAV Tracking Lookup Diagnostic');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Raw input   : ${raw}`);

  const norm     = normalizeCanonical(raw);
  const key18    = normalizeKey18(raw);
  const last8    = normalizeDigitsLast8(raw);
  const carrier  = detectCarrier(norm);
  const scanType = detectType(raw);

  console.log(`  Normalized  : ${norm}`);
  console.log(`  Key-18      : ${key18}`);
  console.log(`  Last-8 digits: ${last8}`);
  console.log(`  Detected carrier  : ${carrier || '(none — unknown format)'}`);
  console.log(`  detectType result : ${scanType}`);
  console.log('────────────────────────────────────────────────────────');

  let allPassed = true;

  // ── Step 1: detectType check ─────────────────────────────────────────────
  if (scanType !== 'TRACKING') {
    console.log(`${FAIL} detectType returned "${scanType}" instead of "TRACKING"`);
    console.log(`   → The controller will NOT call scan-tracking API for this input.`);
    console.log(`   → Fix: expand the carrier prefix patterns in detectType.`);
    allPassed = false;
  } else {
    console.log(`${PASS} detectType correctly identifies this as TRACKING`);
  }

  // ── Step 2: carrier detection for resolveShipmentId ──────────────────────
  if (!carrier) {
    console.log(`${WARN} detectCarrier returned null — resolveShipmentId will attempt DB-only lookup`);
    console.log(`   → registerAndSyncShipment will NOT be called (carrier sync skipped).`);
    console.log(`   → The order can still be found if its shipment_id is already set in the DB.`);
  } else {
    console.log(`${PASS} Carrier "${carrier}" detected — resolveShipmentId will upsert stn row`);
  }

  // ── Step 3: live API check via /api/debug-tracking (if exists) ────────────
  console.log('\n── Live API checks ─────────────────────────────────────');

  const debugUrl = `${BASE}/api/debug-tracking?tracking=${encodeURIComponent(raw)}`;
  try {
    const { status, ok, json } = await fetchJSON(debugUrl);
    if (ok && json) {
      console.log(`${INFO} /api/debug-tracking → HTTP ${status}`);
      if (json.orderFound) {
        console.log(`${PASS} Order found via debug-tracking: order_id=${json.orderId || '?'}, id=${json.dbId || '?'}`);
      } else {
        console.log(`${FAIL} /api/debug-tracking says order not found`);
        if (json.shipmentId) console.log(`   stn row exists: shipment_id=${json.shipmentId}`);
        allPassed = false;
      }
    } else {
      console.log(`${WARN} /api/debug-tracking returned HTTP ${status} — endpoint may not exist`);
    }
  } catch (e) {
    console.log(`${WARN} /api/debug-tracking unreachable: ${e.message}`);
  }

  // ── Step 4: search orders endpoint with full tracking number ─────────────
  const ordersUrl = `${BASE}/api/orders?q=${encodeURIComponent(raw)}`;
  try {
    const { status, ok, json } = await fetchJSON(ordersUrl);
    if (ok && Array.isArray(json?.orders)) {
      const matched = json.orders.filter(o =>
        String(o.tracking_number || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().includes(norm.slice(-8))
      );
      if (matched.length > 0) {
        console.log(`${PASS} /api/orders search (full): found ${matched.length} match(es)`);
        matched.slice(0, 3).forEach(o =>
          console.log(`   → id=${o.id} order_id=${o.order_id} trk=${o.tracking_number} shipment_id=${o.shipment_id}`)
        );
      } else {
        console.log(`${FAIL} /api/orders search (full raw): 0 matches (${json.orders.length} total rows returned)`);
        allPassed = false;
      }
    } else {
      console.log(`${WARN} /api/orders returned HTTP ${status}`);
    }
  } catch (e) {
    console.log(`${WARN} /api/orders unreachable: ${e.message}`);
  }

  // Search by last-8 digits
  const ordersLast8Url = `${BASE}/api/orders?q=${encodeURIComponent(last8)}`;
  try {
    const { status, ok, json } = await fetchJSON(ordersLast8Url);
    if (ok && Array.isArray(json?.orders) && json.orders.length > 0) {
      console.log(`${PASS} /api/orders search (last-8 "${last8}"): found ${json.orders.length} match(es)`);
    } else if (ok) {
      console.log(`${FAIL} /api/orders search (last-8 "${last8}"): 0 matches`);
      allPassed = false;
    }
  } catch (e) {
    console.log(`${WARN} /api/orders (last-8) unreachable: ${e.message}`);
  }

  // ── Step 5: shipped/search check ─────────────────────────────────────────
  const shippedUrl = `${BASE}/api/shipped/search?q=${encodeURIComponent(raw)}`;
  try {
    const { status, ok, json } = await fetchJSON(shippedUrl);
    if (ok && Array.isArray(json?.results)) {
      console.log(`${json.results.length > 0 ? PASS : INFO} /api/shipped/search: ${json.results.length} result(s) for "${raw}"`);
    } else {
      console.log(`${WARN} /api/shipped/search returned HTTP ${status}`);
    }
  } catch (e) {
    console.log(`${WARN} /api/shipped/search unreachable: ${e.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log(`${PASS} All checks passed — tracking lookup should work correctly.`);
  } else {
    console.log(`${FAIL} One or more checks FAILED.`);
    console.log('\n Common fixes:');
    if (scanType !== 'TRACKING') {
      console.log('  • detectType regex in useStationTestingController.ts needs to cover this format');
    }
    if (!carrier) {
      console.log('  • detectCarrier in normalize.ts does not recognise this format');
      console.log('    → resolveShipmentId will rely on DB-only fallback (getShipmentByTracking)');
      console.log('    → Ensure the order was imported with shipment_id already populated');
    }
    console.log('  • Run the orders-exceptions sync: POST /api/orders-exceptions/sync');
    console.log('  • Check that the order has a non-null shipment_id in the orders table');
  }
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
