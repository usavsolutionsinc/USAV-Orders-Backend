export function getOrderPlatformLabel(orderId: string | null | undefined, accountSource: string | null | undefined): string {
  const oid = String(orderId ?? '').trim();
  if (oid === 'Not available' || oid === 'N/A') return '';

  /** Pack/tech rows often lack a linked marketplace order id; still show channel from account_source. */
  if (!oid) {
    const src = String(accountSource || '').trim().toLowerCase();
    if (!src) return '';
    if (src === 'fba') return 'FBA';
    if (src === 'ecwid') return 'ECWID';
    return String(accountSource || '').trim();
  }

  if (isFbaOrder(oid, accountSource)) {
    return 'FBA';
  }

  if (/^\d{3}-\d+-\d+$/.test(oid)) {
    return 'Amazon';
  }

  if (/^\d{2}-\d+-\d+$/.test(oid)) {
    return 'ebay';
  }

  if (/^\d{15}$/.test(oid)) {
    return 'Walmart';
  }

  if (/^\d{4}$/.test(oid)) {
    return 'ECWID';
  }

  return accountSource || '';
}

export function isFbaOrder(orderId: string | null | undefined, accountSource: string | null | undefined): boolean {
  const normalizedOrderId = String(orderId || '').trim().toUpperCase();
  const normalizedAccountSource = String(accountSource || '').trim().toLowerCase();
  return normalizedOrderId.includes('FBA') || normalizedAccountSource === 'fba';
}

const PLATFORM_COLORS: Record<string, { text: string; border: string }> = {
  amazon: { text: 'text-orange-600', border: 'border-orange-600' },
  fba: { text: 'text-orange-600', border: 'border-orange-600' },
  ebay: { text: 'text-yellow-400', border: 'border-yellow-400' },
  ecwid: { text: 'text-blue-600', border: 'border-blue-600' },
  zoho: { text: 'text-red-600', border: 'border-red-600' },
  walmart: { text: 'text-amber-800', border: 'border-amber-800' },
  mercari: { text: 'text-purple-600', border: 'border-purple-600' },
  shopify: { text: 'text-black', border: 'border-black' },
};

const DEFAULT_PLATFORM_COLOR = { text: 'text-gray-400', border: 'border-gray-400' };

export function getOrderPlatformColor(label: string): string {
  const key = label.toLowerCase().split(/\s*-\s*/)[0].trim();
  return (PLATFORM_COLORS[key] || DEFAULT_PLATFORM_COLOR).text;
}

export function getOrderPlatformBorderColor(label: string): string {
  const key = label.toLowerCase().split(/\s*-\s*/)[0].trim();
  return (PLATFORM_COLORS[key] || DEFAULT_PLATFORM_COLOR).border;
}

export function getOrderSourceTag(
  orderId: string | null | undefined,
  accountSource: string | null | undefined,
): 'FBA' | 'Orders' {
  return isFbaOrder(orderId, accountSource) ? 'FBA' : 'Orders';
}
