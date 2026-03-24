/** Extract all unique FNSKU tokens (X00xxxxxxx) from arbitrary text. */
export function parseFnskus(text: string): string[] {
  if (!text) return [];
  const matches = text.toUpperCase().match(/X00[A-Z0-9]{7}/g) ?? [];
  return Array.from(new Set(matches));
}
