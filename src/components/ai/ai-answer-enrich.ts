/**
 * Turns plain assistant prose into interactive content:
 *  - linkifyOrderRefs: order / tracking IDs become links into the dashboard so
 *    every listed record is clickable (works in run-on prose or table rows).
 *  - inferDestination: picks a "Take me there" target from the question + answer
 *    so the user can jump to the full view for all the records.
 */

// Amazon-style (113-1234567-1234567) and USAV internal (#03-14727-23913) refs.
const ORDER_REF_RE = /(#?)(\b\d{2,3}-\d{4,8}-\d{3,8}\b)/g;

/**
 * Linkify order/tracking IDs in assistant Markdown, skipping fenced code and
 * lines that already contain inline code or markdown links (to avoid mangling
 * them). Each ref points at the dashboard shipped view filtered to that ID.
 */
export function linkifyOrderRefs(markdown: string): string {
  if (!markdown) return markdown;
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      if (line.includes('`') || line.includes('](')) return line;
      return line.replace(ORDER_REF_RE, (_m, hash: string, id: string) =>
        `[${hash}${id}](/dashboard?shipped=&search=${encodeURIComponent(id)})`,
      );
    })
    .join('\n');
}

export interface AiDestination {
  label: string;
  href: string;
}

/** Count distinct order-like refs — used to decide if an answer is "list-like". */
export function countOrderRefs(text: string): number {
  if (!text) return 0;
  const seen = new Set<string>();
  for (const m of text.matchAll(ORDER_REF_RE)) seen.add(m[2]);
  return seen.size;
}

/**
 * Best-effort "Take me there" target inferred from the user's question and the
 * answer. Returns null when no clear destination applies.
 */
export function inferDestination(question: string, answer: string): AiDestination | null {
  const t = `${question}\n${answer}`.toLowerCase();
  if (/\b(fba)\b/.test(t)) return { label: 'Open FBA shipments', href: '/fba' };
  if (/\b(repair|ticket|rma)\b/.test(t)) return { label: 'Open repairs', href: '/repair' };
  if (/\b(receiv|incoming|unbox|purchase order|\bpo\b)/.test(t)) return { label: 'Open receiving', href: '/receiving' };
  if (/\b(ship|shipped|order|packed|pack|tracking|deliver)/.test(t)) return { label: 'Open shipped orders', href: '/dashboard?shipped=' };
  if (/\b(stock|inventory|sku|reorder|replenish)/.test(t)) return { label: 'Open inventory', href: '/inventory' };
  return null;
}
