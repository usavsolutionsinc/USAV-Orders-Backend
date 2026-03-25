/** Extract unique 10-char FNSKU (X00…) or ASIN (B0…) tokens from arbitrary text. */
export function parseFnskus(text: string): string[] {
  if (!text) return [];
  const upper = text.toUpperCase();
  const x00 = upper.match(/X00[A-Z0-9]{7}/g) ?? [];
  const b0 = upper.match(/B0[A-Z0-9]{8}/g) ?? [];
  return Array.from(new Set([...x00, ...b0]));
}
