/**
 * Pure formatting for photo share links — turns the API's link list into the
 * block of text that gets copied to the clipboard / dropped via dataTransfer.
 *
 * Kept dependency-free (no React, no DOM) so it is trivially unit-testable and
 * reusable by the drag handler, the "Copy links" button, and any future export.
 */

export interface ShareLinkLine {
  filename: string;
  url: string;
}

export interface FormatShareLinksOptions {
  /** Optional durable group landing page, appended as a header line. */
  groupUrl?: string | null;
  /** Human expiry hint (e.g. "24 hours") appended as a trailing note. */
  expiresInLabel?: string | null;
}

/**
 * Format share links as one `Filename: url` per line.
 *
 * - A single link is returned bare (just the URL) — the common "grab one link"
 *   case, so pasting drops a clean URL rather than a labeled list of one.
 * - Multiple links are labeled per line, optionally prefixed with a group URL
 *   header and suffixed with an expiry note.
 */
export function formatShareLinksText(
  links: ShareLinkLine[],
  options: FormatShareLinksOptions = {},
): string {
  if (links.length === 0) return '';

  // Single link → bare URL (cleanest paste for the most common case).
  if (links.length === 1 && !options.groupUrl) {
    return links[0].url;
  }

  const lines: string[] = [];
  if (options.groupUrl) {
    lines.push(`Photos (${links.length}): ${options.groupUrl}`, '');
  }
  for (const link of links) {
    lines.push(`${link.filename}: ${link.url}`);
  }
  if (options.expiresInLabel) {
    lines.push('', `Links expire in ${options.expiresInLabel}.`);
  }
  return lines.join('\n');
}

/** A `text/uri-list` payload — one URL per line (RFC 2483), for dataTransfer. */
export function formatUriList(links: ShareLinkLine[]): string {
  return links.map((l) => l.url).join('\n');
}
