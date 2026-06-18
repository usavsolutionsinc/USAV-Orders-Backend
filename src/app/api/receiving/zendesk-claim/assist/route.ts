import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getHermesApiUrl, getHermesHeaders } from '@/lib/ai/hermes-client';
import {
  buildReceivingClaimTemplate,
  CLAIM_TYPE_LABEL,
  type ClaimType,
} from '@/lib/zendesk-claim-template';
import { poReceivingLink } from '@/lib/receiving-claim-photos';
import { sanitizeSellerMessage } from '@/lib/ai/seller-message-guard';
import { upsertClaimSellerMessage } from '@/lib/receiving-claim-seller-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AssistRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  reason?: string;
  subject?: string;
  description?: string;
}

interface AssistResult {
  subject?: unknown;
  description?: unknown;
  seller_message?: unknown;
}

const SYSTEM_PROMPT = [
  'You assist a small used-electronics receiving team with supplier/marketplace claims.',
  'Return strict JSON only. No markdown and no prose outside JSON.',
  '',
  'You will receive an editable Zendesk ticket draft and authoritative reference facts.',
  'Produce:',
  '1. A clearer Zendesk subject.',
  '2. A clearer internal Zendesk body.',
  '3. A concise seller-facing message suitable for eBay or a marketplace seller.',
  '',
  'Rules:',
  '- Do not invent facts, quantities, photos, order IDs, PO numbers, tracking numbers, refunds, or outcomes.',
  '- Preserve every important identifier from the draft: PO, tracking, item, receiving link, and issue type.',
  '- Seller message tone: professional, concise, direct, and non-accusatory.',
  '- Seller message should ask for the next practical resolution or evidence request, not threaten escalation.',
  '- If evidence is missing, ask for the proper next step instead of claiming it exists.',
  '- seller_message MUST be plain text only: NEVER include URLs, hyperlinks, or link-like text',
  '  (no http/https, www., or domain/path patterns). Marketplace seller TOS forbids links.',
  '- Do NOT copy internal receiving links from the Zendesk body into seller_message;',
  '  refer to "our receiving record" or "photos on file" instead.',
  '',
  'Required JSON shape:',
  '{',
  '  "subject": "Zendesk subject",',
  '  "description": "Zendesk internal body",',
  '  "seller_message": "Message to seller/marketplace support"',
  '}',
].join('\n');

function extractJsonObject(text: string): AssistResult {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Hermes returned no JSON object');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as AssistResult;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finalizeSellerMessage(raw: string, fallback: string): { message: string; linksStripped: boolean } {
  const base = asString(raw) || fallback;
  return sanitizeSellerMessage(base);
}

async function persistSellerDraft(opts: {
  orgId: string;
  receivingId: number;
  lineId: number | null;
  sellerMessage: string;
  subject: string;
  model: string;
  staffId: number | null;
}): Promise<void> {
  try {
    await upsertClaimSellerMessage({
      orgId: opts.orgId,
      receivingId: opts.receivingId,
      lineId: opts.lineId,
      sellerMessage: opts.sellerMessage,
      subjectSnapshot: opts.subject,
      model: opts.model,
      staffId: opts.staffId,
    });
  } catch (err) {
    console.warn('[zendesk-claim/assist] seller message persist failed', err);
  }
}

function lineValue(description: string, label: string): string {
  const match = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() || 'n/a';
}

function deterministicSellerMessage(opts: {
  claimType: ClaimType;
  reason?: string;
  description: string;
}): string {
  const issue = CLAIM_TYPE_LABEL[opts.claimType];
  const po = lineValue(opts.description, 'Purchase Order');
  const tracking = lineValue(opts.description, 'Tracking');
  const item = lineValue(opts.description, 'Item') || lineValue(opts.description, 'Scope');
  const note = String(opts.reason ?? '').trim();

  return [
    'Hello,',
    '',
    `We received this order with a ${issue.toLowerCase()} issue and need help with the next resolution step.`,
    '',
    `Purchase Order: ${po}`,
    `Tracking: ${tracking}`,
    `Item: ${item}`,
    note ? `Issue details: ${note}` : null,
    '',
    'Please advise whether you would like additional photos/evidence, a return started, or another resolution path. We can provide the receiving record and selected photos if needed.',
    '',
    'Thank you.',
  ].filter(Boolean).join('\n');
}

async function fetchHermesAssist(body: unknown): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = fetch(`${getHermesApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHermesHeaders({
      'content-type': 'application/json',
      'X-Source': 'usav-receiving-claim-assist',
    }),
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const timer = new Promise<Response>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Hermes claim assist timed out'));
    }, 20_000);
  });
  try {
    return await Promise.race([request, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = (await req.json().catch(() => null)) as AssistRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (!body.claimType || !(body.claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }
    const lineId = body.lineId != null ? Number(body.lineId) : null;
    const staffId = ctx.staffId ?? null;

    const template = await buildReceivingClaimTemplate({
      receivingId,
      lineId,
      claimType: body.claimType,
      reason: body.reason,
      poReceivingLink: poReceivingLink(req, receivingId),
    }, orgId);

    const currentSubject = asString(body.subject) || template.subject;
    const currentDescription = asString(body.description) || template.description;
    const model = String(process.env.HERMES_MODEL || 'hermes-agent').trim();
    const fallbackSellerMessage = deterministicSellerMessage({
      claimType: body.claimType,
      reason: body.reason,
      description: currentDescription,
    });

    const respond = async (payload: {
      subject: string;
      description: string;
      sellerMessageRaw: string;
      model: string;
      degraded: boolean;
    }) => {
      const { message: sellerMessage, linksStripped } = finalizeSellerMessage(
        payload.sellerMessageRaw,
        fallbackSellerMessage,
      );
      await persistSellerDraft({
        orgId: orgId,
        receivingId,
        lineId,
        sellerMessage,
        subject: payload.subject,
        model: payload.model,
        staffId,
      });
      return NextResponse.json({
        success: true,
        degraded: payload.degraded,
        subject: payload.subject,
        description: payload.description,
        sellerMessage,
        linksStripped,
        model: payload.model,
      });
    };

    let res: Response;
    try {
      res = await fetchHermesAssist({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 900,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify(
              {
                claim: {
                  type: CLAIM_TYPE_LABEL[body.claimType],
                  operator_note: String(body.reason ?? '').trim(),
                },
                authoritative_template: template,
                current_editable_draft: {
                  subject: currentSubject,
                  description: currentDescription,
                },
              },
              null,
              2,
            ),
          },
        ],
      });
    } catch {
      return respond({
        subject: currentSubject,
        description: currentDescription,
        sellerMessageRaw: fallbackSellerMessage,
        model: 'template-fallback',
        degraded: true,
      });
    }

    if (!res.ok) {
      return respond({
        subject: currentSubject,
        description: currentDescription,
        sellerMessageRaw: fallbackSellerMessage,
        model: 'template-fallback',
        degraded: true,
      });
    }

    try {
      const data = await res.json();
      const raw = String(data?.choices?.[0]?.message?.content ?? '');
      const parsed = extractJsonObject(raw);
      const subject = asString(parsed.subject) || currentSubject;
      const description = asString(parsed.description) || currentDescription;
      const sellerMessageRaw = asString(parsed.seller_message) || fallbackSellerMessage;

      return respond({
        subject,
        description,
        sellerMessageRaw,
        model: String(data?.model || model),
        degraded: false,
      });
    } catch {
      return respond({
        subject: currentSubject,
        description: currentDescription,
        sellerMessageRaw: fallbackSellerMessage,
        model: 'template-fallback',
        degraded: true,
      });
    }
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/assist');
  }
}, { permission: 'receiving.mark_received' });
