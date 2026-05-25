/**
 * Gmail message fetch + MIME decoding for the PO mailbox.
 *
 * Builds on src/lib/po-gmail/client (which handles OAuth) and exposes a
 * small surface tailored to the reconciliation pipeline:
 *   - listMessageIds(query, maxResults)  → IDs only, paginated
 *   - fetchMessage(id)                   → typed envelope + decoded body text
 *   - addLabel / removeLabel / addLabels → idempotency markers ("Scanned/...")
 *
 * Gmail returns message bodies as base64url-encoded strings nested in a
 * tree of MIME parts. We walk the tree depth-first, prefer text/plain, fall
 * back to text/html stripped of tags, and bail out gracefully if neither
 * exists (some vendors send PDFs only — those need attachment handling we
 * haven't built yet).
 */

import DOMPurify from 'isomorphic-dompurify';
import { poGmailFetch } from './client';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessageEnvelope {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string; // epoch ms as string per Gmail spec
  subject: string;
  from: string;
  to: string;
  date: string; // raw Date header
  bodyText: string; // decoded, plaintext-ish (display fallback)
  bodyHtml: string | null; // DOMPurify-sanitized HTML, ready for iframe
  hasAttachments: boolean;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

function base64UrlDecode(data: string): string {
  // Gmail uses URL-safe base64, no padding.
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

// Zero-width / spam-evasion characters injected into many marketing emails.
// Stripping them keeps the plaintext readable and avoids the wall-of-&zwnj;
// output we used to render.
//   U+00AD  soft hyphen
//   U+200B  zero-width space
//   U+200C  zero-width non-joiner (the visible "zwnj" entity decodes to this)
//   U+200D  zero-width joiner
//   U+2060  word joiner
//   U+FEFF  zero-width no-break space / BOM
const INVISIBLE_CHARS_RE = /[­​-‍⁠﻿]/g;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  zwnj: '‌',
  zwj: '‍',
  shy: '­',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return full;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return full;
      }
    }
    return NAMED_ENTITIES[body] ?? full;
  });
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Sanitize raw email HTML for display in a sandboxed iframe. DOMPurify
// strips scripts, event handlers, iframes, and other dangerous nodes; we
// also drop the zero-width spam-evasion characters so the rendered text
// reads cleanly. Returns null when the source HTML is effectively empty.
function sanitizeHtml(html: string): string | null {
  const cleaned = html.replace(INVISIBLE_CHARS_RE, '');
  const safe = DOMPurify.sanitize(cleaned, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOW_DATA_ATTR: false,
  });
  return safe.trim().length > 0 ? safe : null;
}

function pickHeader(part: GmailPart | undefined, name: string): string {
  if (!part?.headers) return '';
  const lower = name.toLowerCase();
  return part.headers.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function walkForBody(part: GmailPart | undefined, want: 'text/plain' | 'text/html'): string | null {
  if (!part) return null;
  if (part.mimeType === want && part.body?.data) {
    return base64UrlDecode(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = walkForBody(child, want);
      if (found) return found;
    }
  }
  return null;
}

function detectAttachments(part: GmailPart | undefined): boolean {
  if (!part) return false;
  if (part.filename && part.filename.length > 0 && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(detectAttachments);
}

function extractBody(payload: GmailPart | undefined): {
  text: string;
  html: string | null;
} {
  const html = walkForBody(payload, 'text/html');
  const plain = walkForBody(payload, 'text/plain');
  return {
    // Plain-text fallback: prefer the multipart text/plain alternative when
    // the sender included one; otherwise derive readable text from the HTML.
    text: plain ? plain.replace(INVISIBLE_CHARS_RE, '') : html ? stripHtml(html) : '',
    html: html ? sanitizeHtml(html) : null,
  };
}

export async function listMessageIds(
  query: string,
  maxResults = 25,
  pageToken?: string,
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(Math.min(Math.max(maxResults, 1), 500)));
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const res = await poGmailFetch(url.toString());
  if (!res.ok) {
    throw new Error(`Gmail messages.list failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as GmailListResponse;
  return {
    ids: json.messages?.map((m) => m.id) ?? [],
    nextPageToken: json.nextPageToken,
  };
}

export async function fetchMessage(id: string): Promise<GmailMessageEnvelope> {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
  url.searchParams.set('format', 'full');

  const res = await poGmailFetch(url.toString());
  if (!res.ok) {
    throw new Error(`Gmail messages.get failed for ${id} (${res.status}): ${await res.text()}`);
  }
  const raw = (await res.json()) as GmailRawMessage;
  const body = extractBody(raw.payload);

  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds ?? [],
    snippet: raw.snippet ?? '',
    internalDate: raw.internalDate ?? '0',
    subject: pickHeader(raw.payload, 'Subject'),
    from: pickHeader(raw.payload, 'From'),
    to: pickHeader(raw.payload, 'To'),
    date: pickHeader(raw.payload, 'Date'),
    bodyText: body.text,
    bodyHtml: body.html,
    hasAttachments: detectAttachments(raw.payload),
  };
}

export async function fetchMessagesByIds(ids: string[]): Promise<GmailMessageEnvelope[]> {
  // Small concurrent fan-out. Gmail's per-user concurrency limits are
  // generous and individual GETs are cheap; we stay under 5 in flight
  // to be polite and avoid 429s when scanning a fresh mailbox.
  const out: GmailMessageEnvelope[] = [];
  const chunkSize = 5;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const results = await Promise.all(slice.map(fetchMessage));
    out.push(...results);
  }
  return out;
}

export async function modifyLabels(
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = [],
): Promise<void> {
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;
  const res = await poGmailFetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  if (!res.ok) {
    throw new Error(`Gmail messages.modify failed for ${messageId} (${res.status}): ${await res.text()}`);
  }
}

/**
 * Look up a label by name; create it if missing. Returns the labelId
 * suitable for passing to modifyLabels(). Caches nothing — callers should
 * resolve once and pass the id around.
 */
export async function getOrCreateLabel(name: string): Promise<string> {
  const listRes = await poGmailFetch(`${GMAIL_API}/labels`);
  if (!listRes.ok) {
    throw new Error(`Gmail labels.list failed (${listRes.status}): ${await listRes.text()}`);
  }
  const list = (await listRes.json()) as { labels?: Array<{ id: string; name: string }> };
  const existing = list.labels?.find((l) => l.name === name);
  if (existing) return existing.id;

  const createRes = await poGmailFetch(`${GMAIL_API}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Gmail labels.create failed (${createRes.status}): ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}
