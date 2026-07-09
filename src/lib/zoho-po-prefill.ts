/**
 * Extract Zendesk ticket / listing URL from Zoho PO header notes.
 * Notes use segments separated by " · " (see mark-received). Prefixes are
 * case-insensitive; first match wins scanning top-to-bottom.
 */
export interface SyncNoteListingLink {
  href: string;
  /** Optional human title prefix before `: https://...` on the line. */
  title: string | null;
}

function normalizeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function trimTrailingPunctuation(url: string): string {
  // Common sync-note formatting: "...: https://…", sometimes followed by punctuation.
  return url.replace(/[),.]+$/g, '');
}

/**
 * Parse every listing link embedded in Zoho PO header sync notes.
 *
 * Common format:
 *   <title>: https://shopgoodwill.com/item/123
 */
export function parseListingLinksFromSyncNotes(
  notes: string | null | undefined,
): SyncNoteListingLink[] {
  const text = String(notes || '').trim();
  if (!text) return [];

  const seen = new Set<string>();
  const out: SyncNoteListingLink[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Extract all URLs on the line (usually just one).
    const matches = [...line.matchAll(/https?:\/\/\S+/gi)];
    if (matches.length === 0) continue;

    const firstUrlStart = matches[0]?.index ?? -1;
    const prefix = firstUrlStart > 0 ? line.slice(0, firstUrlStart).trim() : '';
    const title = prefix.endsWith(':') ? prefix.slice(0, -1).trim() || null : null;

    for (const m of matches) {
      const rawUrl = trimTrailingPunctuation(m[0] ?? '');
      const href = normalizeHref(rawUrl);
      if (!href) continue;
      const key = href.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ href, title });
    }
  }

  return out;
}

export function parseZendeskListingFromPoNotes(notes: string | null | undefined): {
  zendesk: string;
  listing: string;
} {
  const text = String(notes || '').trim();
  if (!text) return { zendesk: '', listing: '' };

  let zendesk = '';
  let listing = '';

  for (const line of text.split('\n')) {
    const segments = line.split(' · ').map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const z = seg.match(/^Zendesk:\s*(.+)$/i);
      if (z?.[1] && !zendesk) zendesk = z[1].trim();
      const l = seg.match(/^Listing:\s*(.+)$/i);
      if (l?.[1] && !listing) listing = l[1].trim();
    }
    if (zendesk && listing) break;
  }

  // Fallback: pick up any https URL in the notes (e.g. eBay, Goodwill, Amazon…).
  // Common format from purchasing imports: "<product title>: https://example.com/item/..."
  if (!listing) {
    const parsed = parseListingLinksFromSyncNotes(text);
    if (parsed[0]?.href) listing = parsed[0].href;
  }

  return { zendesk, listing };
}

/** Current line-item description stores receipt serial as `SN: …` */
export function parseSerialFromLineDescription(
  description: string | null | undefined,
): string {
  const d = String(description || '').trim();
  if (!d) return '';
  const m = d.match(/^SN:\s*(.+)$/i);
  return m?.[1] ? m[1].trim() : '';
}
