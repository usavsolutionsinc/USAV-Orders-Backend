import { getHermesApiUrl, getHermesHeaders } from '@/lib/ai/hermes-client';
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
  '- Include PO, tracking, item, and issue type from the context provided.',
  '- Do not invent facts, quantities, refunds, or outcomes.',
  '- Tone: professional, concise, direct, non-accusatory.',
  '- Ask for the next practical resolution or evidence — do not threaten escalation.',
  '- seller_message MUST be plain text only: NEVER URLs or link-like text (marketplace TOS).',
  '- Do NOT include http/https, www., or domain paths. Ticket # is plain text, not a link.',
].join('\n');

function lineValue(description: string, label: string): string {
  const match = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() || 'n/a';
}

export function buildDeterministicSellerMessage(opts: {
  claimType: ClaimType;
  reason?: string;
  description: string;
  zendeskTicketNumber: string;
}): string {
  const issue = CLAIM_TYPE_LABEL[opts.claimType];
  const po = lineValue(opts.description, 'Purchase Order');
  const tracking = lineValue(opts.description, 'Tracking');
  const item = lineValue(opts.description, 'Item') || lineValue(opts.description, 'Scope');
  const note = String(opts.reason ?? '').trim();
  const ticketRef = opts.zendeskTicketNumber.replace(/^#/, '').trim();

  return [
    'Hello,',
    '',
    `We received this order with a ${issue.toLowerCase()} issue and opened an internal case for our records.`,
    '',
    `Our case reference: #${ticketRef}`,
    `Purchase Order: ${po}`,
    `Tracking: ${tracking}`,
    `Item: ${item}`,
    note ? `Issue details: ${note}` : null,
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
