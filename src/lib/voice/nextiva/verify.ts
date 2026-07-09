import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Nextiva webhook delivery by comparing HMAC-SHA256 of the RAW request
 * body against the signature header. Mirrors src/lib/zoho/webhooks/verify.ts.
 *
 * The exact header name + digest encoding is confirmed in the Phase 0 spike
 * (docs/nextiva-voice-support-mode-plan.md §9) — both are env-overridable so the
 * spike's finding is a config change, not a code change. The caller passes the
 * raw (un-parsed) body; JSON.stringify of the parsed body will not match.
 *
 * Required: a per-tenant signing secret (options.secret) or NEXTIVA_WEBHOOK_SECRET.
 * Optional env (defaults shown):
 *   NEXTIVA_WEBHOOK_SIGNATURE_HEADER   default: x-nextiva-signature
 *   NEXTIVA_WEBHOOK_SIGNATURE_ENCODING hex | base64   default: hex
 */

type VerifyOk = { ok: true };
type VerifyFail = { ok: false; reason: string };
export type VerifyResult = VerifyOk | VerifyFail;

const FALLBACK_HEADERS = [
  'x-nextiva-signature',
  'x-nextiva-webhook-signature',
  'x-webhook-signature',
] as const;

function readSignature(headers: Headers, primary: string): string | null {
  const tried = new Set<string>();
  const candidates = [primary, ...FALLBACK_HEADERS]
    .map((h) => h.toLowerCase().trim())
    .filter((h) => {
      if (!h || tried.has(h)) return false;
      tried.add(h);
      return true;
    });
  for (const header of candidates) {
    const value = headers.get(header);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function decodeSignature(raw: string, encoding: 'hex' | 'base64'): Buffer | null {
  try {
    if (encoding === 'base64') return Buffer.from(raw, 'base64');
    return Buffer.from(raw.replace(/^sha256=/i, ''), 'hex');
  } catch {
    return null;
  }
}

export interface VerifyOptions {
  /** Per-tenant signing secret; falls back to NEXTIVA_WEBHOOK_SECRET. */
  secret?: string;
}

export function verifyNextivaWebhookSignature(
  rawBody: string | Buffer,
  headers: Headers,
  options: VerifyOptions = {},
): VerifyResult {
  const secret = (options.secret || process.env.NEXTIVA_WEBHOOK_SECRET || '').trim();
  if (!secret) return { ok: false, reason: 'no signing secret available (per-org or NEXTIVA_WEBHOOK_SECRET)' };

  const headerName = (process.env.NEXTIVA_WEBHOOK_SIGNATURE_HEADER || 'x-nextiva-signature').trim();
  const encoding: 'hex' | 'base64' =
    (process.env.NEXTIVA_WEBHOOK_SIGNATURE_ENCODING || 'hex').toLowerCase() === 'base64' ? 'base64' : 'hex';

  const sigRaw = readSignature(headers, headerName);
  if (!sigRaw) return { ok: false, reason: 'missing signature header' };

  const sigBuf = decodeSignature(sigRaw, encoding);
  if (!sigBuf || sigBuf.length === 0) return { ok: false, reason: 'malformed signature header' };

  const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(bodyBuf).digest();
  if (expected.length !== sigBuf.length) return { ok: false, reason: 'signature length mismatch' };

  return timingSafeEqual(expected, sigBuf) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
