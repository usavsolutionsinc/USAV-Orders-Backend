import { sanitizeSellerMessage } from '@/lib/ai/seller-message-guard';
import {
  CLAIM_TYPE_LABEL,
  type ClaimType,
} from '@/lib/zendesk-claim-template';

export const SELLER_ONLY_SYSTEM_PROMPT = [
  'You draft seller-facing messages for a used-electronics receiving team.',
  'Return strict JSON only: { "seller_message": "..." }. No markdown outside JSON.',
  '',
  'The internal Zendesk ticket is ALREADY FILED. The operator will paste your message',
  'into eBay or another marketplace — it does NOT post automatically.',
  '',
  'Rules:',
  '- Include the internal Zendesk ticket number as plain text (e.g. "Our case reference: #5637").',
  '- Include PO, tracking, item, serial number(s), and issue type from the context provided.',
  '  If a Serial / Serials line is present in the body, list the serial number(s) verbatim.',
  '- Do not invent facts, quantities, refunds, or outcomes.',
  '- If the claim type is Return, frame this as a return / RMA request — ask for',
  '  return authorization and the next steps — NOT a damage or defect complaint.',
  '- Tone: professional, concise, direct, non-accusatory.',
  '- Format as a short email, NOT one run-on paragraph: a greeting line, then one or',
  '  two short body paragraphs, then a closing line. Separate paragraphs with a blank',
  '  line (\\n\\n). Put the case reference / PO / tracking on their own lines.',
  '- Ask for the next practical resolution or evidence — do not threaten escalation.',
  '- seller_message MUST be plain text only: NEVER URLs or link-like text (marketplace TOS).',
  '- Do NOT include http/https, www., or domain paths. Ticket # is plain text, not a link.',
].join('\n');

function lineValue(description: string, label: string): string {
  const match = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() || 'n/a';
}

/** PO#/tracking now ride in the SUBJECT (// PO … // TRK#…), not the body. */
function valueFromSubject(subject: string, kind: 'po' | 'tracking'): string | null {
  if (kind === 'po') return subject.match(/\/\/\s*PO\s+(.+?)\s*(?:\/\/|$)/i)?.[1]?.trim() || null;
  return subject.match(/TRK#\s*(\S+)/i)?.[1]?.trim() || null;
}

export function buildDeterministicSellerMessage(opts: {
  claimType: ClaimType;
  reason?: string;
  description: string;
  /** Ticket subject — the source of truth for PO#/tracking now. */
  subject?: string;
  zendeskTicketNumber: string;
}): string {
  const issue = CLAIM_TYPE_LABEL[opts.claimType];
  const subject = opts.subject ?? '';
  const po = valueFromSubject(subject, 'po') || lineValue(opts.description, 'Purchase Order');
  const tracking = valueFromSubject(subject, 'tracking') || lineValue(opts.description, 'Tracking');
  const item = lineValue(opts.description, 'Item') || lineValue(opts.description, 'Scope');
  // Serials live on a "Serials:" (plural) or "Serial:" line in the body.
  const serialsLine = lineValue(opts.description, 'Serials');
  const serials = serialsLine !== 'n/a' ? serialsLine : lineValue(opts.description, 'Serial');
  const note = String(opts.reason ?? '').trim();
  const ticketRef = opts.zendeskTicketNumber.replace(/^#/, '').trim();

  // Returns read differently from defect/damage claims.
  const isReturn = opts.claimType === 'return';
  const opening = isReturn
    ? 'We are processing a return for this order and opened an internal case for our records.'
    : `We received this order with a ${issue.toLowerCase()} issue and opened an internal case for our records.`;
  const detailLabel = isReturn ? 'Return details' : 'Issue details';

  return [
    'Hello,',
    '',
    opening,
    '',
    `Our case reference: #${ticketRef}`,
    `Purchase Order: ${po}`,
    `Tracking: ${tracking}`,
    `Item: ${item}`,
    serials !== 'n/a' ? `Serial${serials.includes(',') ? 's' : ''}: ${serials}` : null,
    note ? `${detailLabel}: ${note}` : null,
    '',
    'Please advise on the next resolution step. We can provide photos or additional evidence from our receiving record if needed.',
    '',
    'Thank you.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractSellerJson(text: string): { seller_message?: unknown } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Hermes returned no JSON object');
  return JSON.parse(trimmed.slice(start, end + 1)) as { seller_message?: unknown };
}

async function fetchHermes(body: unknown): Promise<Response> {
  // Lazy import: hermes-client is `server-only`, so keep it off this module's
  // static graph — the pure buildDeterministicSellerMessage stays unit-testable.
  const { getHermesApiUrl, getHermesHeaders } = await import('@/lib/ai/hermes-client');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = fetch(`${getHermesApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHermesHeaders({
      'content-type': 'application/json',
      'X-Source': 'usav-receiving-claim-assist-seller',
    }),
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const timer = new Promise<Response>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Hermes seller assist timed out'));
    }, 20_000);
  });
  try {
    return await Promise.race([request, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface SellerAssistInput {
  claimType: ClaimType;
  reason?: string;
  subject: string;
  description: string;
  zendeskTicketNumber: string;
}

export interface SellerAssistResult {
  sellerMessage: string;
  linksStripped: boolean;
  model: string;
  degraded: boolean;
}

export async function draftSellerMessageWithHermes(
  input: SellerAssistInput,
): Promise<SellerAssistResult> {
  const model = String(process.env.HERMES_MODEL || 'hermes-agent').trim();
  const fallback = buildDeterministicSellerMessage({
    claimType: input.claimType,
    reason: input.reason,
    description: input.description,
    subject: input.subject,
    zendeskTicketNumber: input.zendeskTicketNumber,
  });

  const finish = (raw: string, usedModel: string, degraded: boolean): SellerAssistResult => {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const { message, linksStripped } = sanitizeSellerMessage(trimmed || fallback);
    return { sellerMessage: message, linksStripped, model: usedModel, degraded };
  };

  try {
    const res = await fetchHermes({
      model,
      stream: false,
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SELLER_ONLY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(
            {
              filed_zendesk_ticket: input.zendeskTicketNumber,
              internal_ticket: {
                subject: input.subject,
                body: input.description,
              },
              claim: {
                type: CLAIM_TYPE_LABEL[input.claimType],
                operator_note: String(input.reason ?? '').trim(),
              },
            },
            null,
            2,
          ),
        },
      ],
    });

    if (!res.ok) {
      return finish(fallback, 'template-fallback', true);
    }

    const data = await res.json();
    const raw = String(data?.choices?.[0]?.message?.content ?? '');
    const parsed = extractSellerJson(raw);
    const sellerRaw =
      typeof parsed.seller_message === 'string' ? parsed.seller_message.trim() : '';
    return finish(sellerRaw, String(data?.model || model), !sellerRaw);
  } catch {
    return finish(fallback, 'template-fallback', true);
  }
}
