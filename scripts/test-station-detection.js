const TRACKING_PATTERNS = [
  { carrier: 'UPS', regex: /^1Z[A-Z0-9]{16}$/ },
  { carrier: 'FEDEX', regex: /^9621\d{29,30}$/ },
  { carrier: 'FEDEX', regex: /^399\d{9}$/ },
  { carrier: 'FEDEX', regex: /^(96\d{20}|1[456789]\d{14}|\d{20}|\d{15}|\d{12})$/ },
  { carrier: 'USPS', regex: /^(9[2345][0-9]{18,20}|9[0-9]{15,21}|[0-9]{20,22})$/ },
  { carrier: 'DHL_ECOMMERCE', regex: /^JD\d{18}$/ },
  { carrier: 'DHL_EXPRESS', regex: /^\d{10,11}$/ },
  { carrier: 'AMAZON', regex: /^TBA\d{12}$/ },
  { carrier: 'UPU_INTL', regex: /^[A-Z]{2}\d{9}[A-Z]{2}$/ },
  { carrier: 'ONTRAC', regex: /^C\d{14}$/ },
  { carrier: 'LASERSHIP', regex: /^1LS\d{12}$/ },
  { carrier: 'GSO', regex: /^[A-Z]{2}\d{14}$/ },
];

const SERIAL_FULL_REGEX = /^[A-Z0-9]{15,17}([A-Z]{2})?$/i;
const SERIAL_PARTIAL_REGEX = /^[A-Z0-9]{1,8}$/i;

function classifyInput(raw) {
  const stripped = String(raw || '').trim().replace(/\s+/g, '');
  if (!stripped) return { type: 'unknown', carrier: null, normalized: '' };
  const norm = stripped.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (const pattern of TRACKING_PATTERNS) {
    if (pattern.regex.test(norm)) {
      return { type: 'tracking', carrier: pattern.carrier, normalized: norm };
    }
  }

  if (norm.length >= 20) {
    return { type: 'tracking', carrier: null, normalized: norm };
  }

  if (norm.length >= 10 && /\d$/.test(norm)) {
    return { type: 'tracking', carrier: null, normalized: norm };
  }

  if (SERIAL_FULL_REGEX.test(stripped)) {
    return { type: 'serial_full', carrier: null, normalized: stripped.toUpperCase() };
  }

  if (SERIAL_PARTIAL_REGEX.test(stripped)) {
    return { type: 'serial_partial', carrier: null, normalized: stripped.toUpperCase() };
  }

  return { type: 'unknown', carrier: null, normalized: norm };
}

function detectType(val) {
  const input = String(val || '').trim();
  if (!input) return 'SERIAL';
  if (input.includes(':')) return 'SKU';
  if (/^RS-\d+$/i.test(input)) return 'REPAIR';
  if (/^(X0|B0)/i.test(input.toUpperCase().replace(/[^A-Z0-9]/g, ''))) return 'FNSKU';
  if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
  const { type } = classifyInput(input);
  if (type === 'tracking') return 'TRACKING';
  return 'SERIAL';
}

function getStationInputMode(val) {
  const input = String(val || '').trim();
  if (/^RS-/i.test(input)) return 'repair';
  const type = detectType(input);
  if (type === 'FNSKU') return 'fba';
  if (type === 'REPAIR') return 'repair';
  if (type === 'TRACKING' || type === 'COMMAND') return 'tracking';
  return 'serial';
}

function looksLikeFnsku(value) {
  const v = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^X0[A-Z0-9]{8,10}$/.test(v) || /^B0[A-Z0-9]{8,}$/.test(v);
}

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

const sampleFnsku = ['X0ABC1234567890', 'B0123456789ABCD', 'X00LONGFNKUITEM'];

const endpointForType = {
  TRACKING: '/api/tech/scan-tracking',
  SERIAL: '/api/tech/add-serial',
  FNSKU: '/api/tech/scan-fnsku',
  SKU: '/api/tech/scan-sku',
  REPAIR: '/api/repair-service',
  COMMAND: '/api/tech/scan-tracking',
};

function logSamples(label, values) {
  console.log(`\n${label}:`);
  for (const value of values) {
    const type = detectType(value);
    const mode = getStationInputMode(value);
    const classifier = classifyInput(value);
    console.log(`  "${value}" → type=${type}, carrier=${classifier.carrier || 'generic'}, mode=${mode}, endpoint=${endpointForType[type]}`);
  }
}

logSamples('Tracking candidates', sampleTracking);
logSamples('Serial candidates', sampleSerial);
logSamples('FNSKU candidates', sampleFnsku);
