import 'server-only';

import { EbayClient } from '@/lib/ebay/client';
import { buildSourceHash } from '@/lib/documents/fetch-idempotency';
import type { OutboundDocumentType } from '@/lib/documents/types';
import type { OutboundOrderContext } from './order-context';
import type { MarketplaceDocumentAdapter, MarketplaceFetchOutcome } from './types';

function ebayAccountFromSource(accountSource: string | null): string | null {
  const src = (accountSource ?? '').trim();
  if (!src) return null;
  return src;
}

export const ebayDocumentAdapter: MarketplaceDocumentAdapter = {
  platform: 'ebay',

  canFetch(order) {
    return detectEbay(order);
  },

  async fetchDocument(order, type, orgId): Promise<MarketplaceFetchOutcome> {
    if (type === 'shipping_label') {
      return {
        ok: false,
        error: 'eBay does not expose printable shipping-label PDFs via API — upload the label manually.',
      };
    }

    const accountName = ebayAccountFromSource(order.accountSource);
    if (!accountName) {
      return { ok: false, error: 'No eBay account is linked to this order.' };
    }

    try {
      const client = new EbayClient(accountName, orgId);
      const ebayOrder = await client.getOrderDetails(order.orderRef);
      const lineItems = Array.isArray(ebayOrder?.lineItems) ? ebayOrder.lineItems : [];
      const lines = lineItems.map((item: Record<string, unknown>) => ({
        sku: typeof item.sku === 'string' ? item.sku : null,
        title: typeof item.title === 'string' ? item.title : null,
        quantity: item.quantity != null ? String(item.quantity) : '1',
      }));

      const shipTo = ebayOrder?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      const shipToLabel = shipTo
        ? [
            shipTo.fullName,
            shipTo.contactAddress?.addressLine1,
            shipTo.contactAddress?.city,
            shipTo.contactAddress?.stateOrProvince,
            shipTo.contactAddress?.postalCode,
          ]
            .filter(Boolean)
            .join(', ')
        : null;

      const { generatePackingSlipPdf } = await import('@/lib/documents/generate-packing-slip-pdf');
      const buffer = generatePackingSlipPdf({
        orderRef: order.orderRef,
        platform: 'ebay',
        tracking: order.tracking,
        shipTo: shipToLabel,
        lines: lines.length > 0 ? lines : [{ sku: order.sku, title: order.productTitle, quantity: order.quantity }],
      });

      const sourceHash = buildSourceHash({
        platform: 'ebay',
        orderRef: order.orderRef,
        documentType: type,
        shipmentId: order.shipmentId,
      });

      return {
        ok: true,
        buffer,
        contentType: 'application/pdf',
        extension: 'pdf',
        filename: `ebay-slip-${order.orderRef}.pdf`,
        platform: 'ebay',
        source: 'marketplace_api',
        tracking: order.tracking,
        carrier: order.carrier,
        sourceHash,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'eBay order fetch failed',
      };
    }
  },
};

function detectEbay(order: OutboundOrderContext): boolean {
  return (order.accountSource ?? '').toLowerCase().includes('ebay');
}
