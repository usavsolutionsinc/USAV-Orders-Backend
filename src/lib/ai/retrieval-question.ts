/**
 * Pure retrieval-shaped question heuristic — shared by Hermes chat enrichment
 * (search-context) and the header→assistant handoff (client-safe; no DB).
 */

/** Only retrieval-shaped questions get a search block — pure chitchat,
 *  pace/metrics, and how-to questions don't need entity hits. Deliberately
 *  broad: a false positive costs one cheap indexed query. */
const RETRIEVAL_HINT =
  /\b(find|search|look\s*up|where|which|show|list|locate|any|have\s+we|do\s+we|got\s+any|status\s+of|what.*(order|unit|serial|sku|carton|shipment|repair|tracking))\b/i;

export function looksLikeRetrievalQuestion(message: string): boolean {
  return RETRIEVAL_HINT.test(message);
}
