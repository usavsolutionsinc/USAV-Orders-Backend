/**
 * Escape user input destined for a LIKE / ILIKE pattern.
 *
 * Search terms are passed as bound parameters (so they're injection-safe), but
 * the LIKE metacharacters `%` and `_` inside the term are still interpreted as
 * wildcards. An unescaped `%` from the user turns a search into a match-all that
 * defeats trigram/btree indexes → full scans (cheap CU-hour DoS) and surprising
 * results. Escape `\ % _` so the user's literal characters match literally.
 *
 * Postgres LIKE/ILIKE uses backslash as the default escape char, so no explicit
 * `ESCAPE` clause is needed — just wrap the result: `` `%${escapeLike(q)}%` ``.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
