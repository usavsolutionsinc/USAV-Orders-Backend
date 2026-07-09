import { generatePackingSlipPdf } from '@/lib/documents/generate-packing-slip-pdf';
import { buildSourceHash } from '@/lib/documents/fetch-idempotency';
import type { OutboundDocumentType } from '@/lib/documents/types';
import type { OutboundOrderContext } from './order-context';
import type { MarketplaceDocumentAdapter, MarketplaceFetchOutcome } from './types';

/**
 * Platform-specific adapter that builds a packing slip PDF from order row data.
 * Used for Amazon, ECWID, and Walmart until dedicated marketplace APIs are wired.
 */
export function createGeneratedPlatformAdapter(
  platform: string,
  canFetch: (order: OutboundOrderContext) => boolean,
): MarketplaceDocumentAdapter {
  return {
    platform,

    canFetch,

    async fetchDocument(order, type): Promise<MarketplaceFetchOutcome> {
      if (type !== 'packing_slip') {
        return {
          ok: false,
          error: 'Shipping labels must be uploaded manually or fetched from your carrier integration.',
        };
      }

      const buffer = generatePackingSlipPdf({
        orderRef: order.orderRef,
        platform,
        tracking: order.tracking,
        lines: [
          {
            sku: order.sku,
            title: order.productTitle,
            quantity: order.quantity,
          },
        ],
      });

      const sourceHash = buildSourceHash({
        platform,
        orderRef: order.orderRef,
        documentType: type,
        shipmentId: order.shipmentId,
      });

      return {
        ok: true,
        buffer,
        contentType: 'application/pdf',
        extension: 'pdf',
        filename: `${platform}-slip-${order.orderRef}.pdf`,
        platform,
        source: 'generated',
        tracking: order.tracking,
        carrier: order.carrier,
        sourceHash,
      };
    },
  };
}

function sourceIncludes(order: OutboundOrderContext, token: string): boolean {
  return (order.accountSource ?? '').toLowerCase().includes(token);
}

export const amazonDocumentAdapter = createGeneratedPlatformAdapter('amazon', (order) =>
  sourceIncludes(order, 'amazon') || sourceIncludes(order, 'fba'),
);

export const ecwidDocumentAdapter = createGeneratedPlatformAdapter('ecwid', (order) =>
  sourceIncludes(order, 'ecwid'),
);

export const walmartDocumentAdapter = createGeneratedPlatformAdapter('walmart', (order) =>
  sourceIncludes(order, 'walmart'),
);
