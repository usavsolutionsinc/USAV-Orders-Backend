const SENTINEL_EMPTY = /^(no data|n\/a|not specified|null|undefined|none)$/i;

export function isEmptyDisplayValue(value: string | null | undefined): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  return SENTINEL_EMPTY.test(s);
}

/** Empty-state label for missing marketplace item # in station / up-next cards. */
export function missingItemNumberLabel(
  _orderId: string,
  _accountSource: string | null | undefined,
): string {
  return 'N/A';
}

export type StationOrderVariant = 'order' | 'fba' | 'repair';

export function missingItemNumberLabelForStation(
  _orderId: string,
  _variant: StationOrderVariant,
  _accountSource?: string | null,
): string {
  return 'N/A';
}
