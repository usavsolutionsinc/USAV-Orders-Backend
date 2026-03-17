export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}
