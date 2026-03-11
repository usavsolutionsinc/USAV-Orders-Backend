export function getOrderPlatformLabel(orderId: string, accountSource: string | null | undefined): string {
  if (!orderId || orderId === 'Not available' || orderId === 'N/A') return '';

  if (isFbaOrder(orderId, accountSource)) {
    return 'FBA';
  }

  if (/^\d{3}-\d+-\d+$/.test(orderId)) {
    return 'Amazon';
  }

  if (/^\d{2}-\d+-\d+$/.test(orderId)) {
    return accountSource ? `ebay - ${accountSource}` : 'ebay';
  }

  if (/^\d{15}$/.test(orderId)) {
    return 'Walmart';
  }

  if (/^\d{4}$/.test(orderId)) {
    return 'ECWID';
  }

  return accountSource || '';
}

export function isFbaOrder(orderId: string | null | undefined, accountSource: string | null | undefined): boolean {
  const normalizedOrderId = String(orderId || '').trim().toUpperCase();
  const normalizedAccountSource = String(accountSource || '').trim().toLowerCase();
  return normalizedOrderId.includes('FBA') || normalizedAccountSource === 'fba';
}

export function getOrderSourceTag(
  orderId: string | null | undefined,
  accountSource: string | null | undefined,
): 'FBA' | 'Orders' {
  return isFbaOrder(orderId, accountSource) ? 'FBA' : 'Orders';
}
