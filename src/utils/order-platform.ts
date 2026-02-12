export function getOrderPlatformLabel(orderId: string, accountSource: string | null | undefined): string {
  if (!orderId || orderId === 'Not available' || orderId === 'N/A') return '';

  if (orderId.toUpperCase().includes('FBA')) {
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

