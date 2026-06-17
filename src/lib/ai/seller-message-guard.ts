/**
 * Marketplace seller messages must be plain text — no URLs (eBay / marketplace TOS).
 * Applied server-side to Hermes `seller_message` output and operator edits.
 */

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const DOMAIN_PATH_RE =
  /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|us|edu|gov)(?:\/[^\s]*)?/gi;

function testLinkPattern(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

function replaceLinkPattern(text: string, re: RegExp): string {
  re.lastIndex = 0;
  return text.replace(re, '[link removed]');
}

export function sellerMessageHasLinks(text: string): boolean {
  const t = String(text ?? '');
  return testLinkPattern(t, URL_RE) || testLinkPattern(t, DOMAIN_PATH_RE);
}

/** Remove link-like substrings; collapse extra whitespace. */
export function stripLinksFromSellerMessage(text: string): string {
  let out = String(text ?? '');
  out = replaceLinkPattern(out, URL_RE);
  out = replaceLinkPattern(out, DOMAIN_PATH_RE);
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Enforce no-link policy; returns whether anything was removed. */
export function sanitizeSellerMessage(text: string): { message: string; linksStripped: boolean } {
  const raw = String(text ?? '').trim();
  if (!raw) return { message: '', linksStripped: false };
  if (!sellerMessageHasLinks(raw)) return { message: raw, linksStripped: false };
  return { message: stripLinksFromSellerMessage(raw), linksStripped: true };
}
