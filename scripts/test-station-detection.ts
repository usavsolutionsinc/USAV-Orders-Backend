/**
 * Regression checks for station scan routing + scan-resolver.
 * Run: node scripts/test-station-detection.js   (wraps npx tsx)
 *   or: npx tsx scripts/test-station-detection.ts
 */

import { classifyInput } from '../src/lib/scan-resolver';
import { detectStationScanType, getStationInputMode } from '../src/lib/station-scan-routing';

const endpointForType: Record<string, string> = {
  TRACKING: '/api/tech/scan-tracking',
  SERIAL: '/api/tech/add-serial',
  FNSKU: '/api/tech/scan-fnsku',
  SKU: '/api/tech/scan-sku',
  REPAIR: '/api/repair-service',
  COMMAND: '/api/tech/scan-tracking',
};

const sampleTracking = [
  '399889137478',
  '9310810989911209302829',
  '1ZJ22B104213611959',
  '1Z1A375J4236099029',
  '399843088717',
  '1ZJ22B104233608596',
  '1Z1A375J4209593483',
  '399842945984',
  '1ZJ22B104216873733',
  '420236079400150206217610616962',
  '9434650106151048421237',
  '9621091390006094377900399889137478',
  '9621091390006094377900399863359798',
];

const sampleSerial = [
  '019158902290447AC',
  '041793983150189AC',
  '024643930900362BC',
  '0427A',
  '1215',
  '0702',
];

/** Exactly 10 chars: X00 + 7 or B0 + 8 */
const sampleFnsku = ['X001234567', 'B012345678', 'X00ABCDEFG'];

function logSamples(label: string, values: string[]) {
  console.log(`\n${label}:`);
  for (const value of values) {
    const type = detectStationScanType(value);
    const mode = getStationInputMode(value);
    const classifier = classifyInput(value);
    console.log(
      `  "${value}" → type=${type}, carrier=${classifier.carrier ?? 'generic'}, mode=${mode}, endpoint=${endpointForType[type]}`,
    );
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

let failures = 0;
for (const v of sampleTracking) {
  const t = detectStationScanType(v);
  if (t !== 'TRACKING') {
    console.error(`Expected TRACKING for "${v}", got ${t}`);
    failures++;
  }
}
for (const v of sampleSerial) {
  const t = detectStationScanType(v);
  if (t !== 'SERIAL') {
    console.error(`Expected SERIAL for "${v}", got ${t}`);
    failures++;
  }
}
for (const v of sampleFnsku) {
  const t = detectStationScanType(v);
  if (t !== 'FNSKU') {
    console.error(`Expected FNSKU for "${v}", got ${t}`);
    failures++;
  }
}

/** Must be classifyInput serial_partial + station SERIAL (not unknown / tracking). */
const mustBeSerialPartial = ['1ZSHORT', 'ABCDEFGHIJ', '123456789'];
for (const v of mustBeSerialPartial) {
  const c = classifyInput(v);
  if (c.type !== 'serial_partial') {
    console.error(`Expected classifyInput("${v}").type serial_partial, got ${c.type}`);
    failures++;
  }
  if (detectStationScanType(v) !== 'SERIAL') {
    console.error(`Expected detectStationScanType("${v}") SERIAL, got ${detectStationScanType(v)}`);
    failures++;
  }
}

assert(failures === 0, `${failures} classification mismatch(es)`);

logSamples('Tracking candidates', sampleTracking);
logSamples('Serial candidates', sampleSerial);
logSamples('FNSKU candidates', sampleFnsku);
logSamples('Short ambiguous → serial_partial', mustBeSerialPartial);

console.log('\nAll station-detection assertions passed.');
