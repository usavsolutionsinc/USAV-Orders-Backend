function getCarrier(tracking: string): 'USPS' | 'UPS' | 'FedEx' | 'Unknown' {
  const t = tracking.toUpperCase();
  if (t.startsWith('1Z')) return 'UPS';
  if (t.startsWith('94') || t.startsWith('93') || t.startsWith('92')) return 'USPS';
  if (t.startsWith('96')) return 'FedEx';
  return 'Unknown';
}

export function getTrackingUrl(tracking: string): string | null {
  if (!tracking || tracking === 'Not available' || tracking === 'N/A') return null;
  const carrier = getCarrier(tracking);
  switch (carrier) {
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`;
    case 'UPS':
      return `https://www.ups.com/track?track=yes&trackNums=${tracking}&loc=en_US&requester=ST/trackdetails`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${tracking}&trkqual=12029~397652017412~FDEG`;
    default:
      return null;
  }
}

export function getOrderIdUrl(orderId: string): string | null {
  if (!orderId || orderId === 'Not available' || orderId === 'N/A') return null;
  if (/^\d{3}-\d+-\d+$/.test(orderId)) {
    return `https://sellercentral.amazon.com/orders-v3/order/${orderId}`;
  }
  if (/^\d{4}$/.test(orderId)) {
    return `https://my.ecwid.com/store/16593703#order:id=${orderId}&use_cache=true&return=orders`;
  }
  return null;
}

export function getAccountSourceLabel(orderId: string, accountSource: string | null | undefined): string {
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
