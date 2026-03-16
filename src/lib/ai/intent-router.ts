export type IntentDomain =
  | 'orders'
  | 'shipped'
  | 'staff'
  | 'repair'
  | 'receiving'
  | 'fba'
  | 'inventory'
  | 'exceptions';

export type IntentParams = {
  staffName?: string;
  orderId?: string;
  trackingNumber?: string;
  sku?: string;
  ticketNumber?: string;
  repairStatus?: string;
};

const DOMAIN_RULES: Array<{
  domain: IntentDomain;
  patterns: RegExp[];
}> = [
  {
    domain: 'orders',
    patterns: [
      /\border(s)?\b/i,
      /\bpending\b/i,
      /\bunshipped\b/i,
      /\boverdue\b/i,
      /\bdue today\b/i,
      /\bbacklog\b/i,
      /\bqueue\b/i,
      /\bassign(ed|ment)?\b/i,
    ],
  },
  {
    domain: 'shipped',
    patterns: [
      /\bshipped\b/i,
      /\btracking\b/i,
      /\bdelivered\b/i,
      /\bserial(s)?\b/i,
      /\bhistory\b/i,
      /\bpacked\b/i,
    ],
  },
  {
    domain: 'staff',
    patterns: [
      /\btech(nician)?(s)?\b/i,
      /\bpacker(s)?\b/i,
      /\bstaff\b/i,
      /\bgoal(s)?\b/i,
      /\bperformance\b/i,
      /\bcount(s)?\b/i,
      /\bshift\b/i,
      /\btoday\b/i,
      /\bweek\b/i,
      /\bdoing\b/i,
    ],
  },
  {
    domain: 'repair',
    patterns: [
      /\brepair(s|ed)?\b/i,
      /\bticket\b/i,
      /\bcustomer\b/i,
      /\bfix\b/i,
      /\bparts?\b/i,
      /\bmissing\b/i,
      /\bwaiting for parts\b/i,
    ],
  },
  {
    domain: 'receiving',
    patterns: [
      /\breceiving\b/i,
      /\bunboxing\b/i,
      /\binbound\b/i,
      /\barrive(d|s|ing)?\b/i,
      /\breturn(s)?\b/i,
      /\bpackage(s)?\b/i,
      /\bpo\b/i,
    ],
  },
  {
    domain: 'fba',
    patterns: [
      /\bfba\b/i,
      /\bamazon\b/i,
      /\bfnsku\b/i,
      /\bfulfillment\b/i,
      /\basin\b/i,
      /\bshipment(s)?\b/i,
    ],
  },
  {
    domain: 'inventory',
    patterns: [
      /\bstock\b/i,
      /\bsku\b/i,
      /\binventory\b/i,
      /\blow stock\b/i,
      /\blevel(s)?\b/i,
      /\bquantity\b/i,
      /\bqty\b/i,
      /\bunit(s)?\b/i,
    ],
  },
  {
    domain: 'exceptions',
    patterns: [
      /\bexception(s)?\b/i,
      /\bunmatched\b/i,
      /\bnot found\b/i,
      /\berror(s)?\b/i,
      /\bmiss(ing|ed)?\b/i,
      /\bopen exception(s)?\b/i,
    ],
  },
];

const STAFF_QUESTION_HINTS = [
  /\bwho\b/i,
  /\bhow is\b/i,
  /\bhow's\b/i,
  /\bdoing\b/i,
  /\bhit their goal\b/i,
  /\bperformance\b/i,
];

const REPAIR_STATUS_MAP: Array<[RegExp, string]> = [
  [/\bwaiting for parts\b/i, 'waiting_for_parts'],
  [/\bout of stock\b/i, 'waiting_for_parts'],
  [/\bpending repair\b/i, 'Pending Repair'],
  [/\brepaired\b/i, 'Repaired, Contact Customer'],
  [/\bawaiting pickup\b/i, 'Awaiting Pickup'],
  [/\bpicked up\b/i, 'Picked Up'],
  [/\bshipped\b/i, 'Shipped'],
  [/\bdone\b/i, 'Done'],
];

function uniquePush(values: IntentDomain[], value: IntentDomain) {
  if (!values.includes(value)) values.push(value);
}

function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function detectIntents(message: string): IntentDomain[] {
  const text = message.trim();
  if (!text) return [];

  const scored = DOMAIN_RULES
    .map(({ domain, patterns }) => ({
      domain,
      score: patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const intents: IntentDomain[] = [];
  for (const entry of scored) {
    if (intents.length >= 3) break;
    uniquePush(intents, entry.domain);
  }

  return intents;
}

export function extractParams(message: string, intents: IntentDomain[]): IntentParams {
  const params: IntentParams = {};
  const text = message.trim();

  const orderIdMatch =
    text.match(/\border\s*#?\s*([A-Z0-9-]{4,})\b/i) ||
    text.match(/\b(1\d{2}-\d{4,}-\d{4,})\b/) ||
    text.match(/\b#([A-Z0-9-]{4,})\b/);
  if (orderIdMatch?.[1]) {
    params.orderId = orderIdMatch[1].trim();
  }

  const trackingMatch =
    text.match(/\b(1Z[0-9A-Z]{16,})\b/i) ||
    text.match(/\b(9[0-9A-Z]{15,30})\b/i) ||
    text.match(/\b([A-Z]{2}[0-9]{9}[A-Z]{2})\b/i);
  if (trackingMatch?.[1]) {
    params.trackingNumber = normalizeTrackingNumber(trackingMatch[1]);
  }

  const skuMatch =
    text.match(/\bsku\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{1,})\b/i) ||
    text.match(/\bstock for\s+([A-Z0-9][A-Z0-9._/-]{1,})\b/i);
  if (skuMatch?.[1]) {
    params.sku = skuMatch[1].trim();
  }

  const ticketMatch =
    text.match(/\bticket\s*[:#-]?\s*([A-Z]{1,5}-?\d{1,6})\b/i) ||
    text.match(/\b(RS-?\d{1,6})\b/i);
  if (ticketMatch?.[1]) {
    params.ticketNumber = ticketMatch[1].trim().toUpperCase();
  }

  for (const [pattern, value] of REPAIR_STATUS_MAP) {
    if (pattern.test(text)) {
      params.repairStatus = value;
      break;
    }
  }

  if (intents.includes('staff') || STAFF_QUESTION_HINTS.some((pattern) => pattern.test(text))) {
    const staffMatch =
      text.match(/\b(?:how is|how's|is|show|tell me about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/) ||
      text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:doing|performing)\b/);
    if (staffMatch?.[1]) {
      params.staffName = staffMatch[1].trim();
    }
  }

  return params;
}
