/**
 * Extract Zendesk ticket / listing URL from Zoho PO header notes.
 * Notes use segments separated by " · " (see mark-received). Prefixes are
 * case-insensitive; first match wins scanning top-to-bottom.
 */
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
