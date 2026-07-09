import { generatePackingSlipPdf } from '@/lib/documents/generate-packing-slip-pdf';
import { buildSourceHash } from '@/lib/documents/fetch-idempotency';
import type { OutboundDocumentType } from '@/lib/documents/types';
import { detectOutboundPlatform } from './order-context';
import type { OutboundOrderContext } from './order-context';
import type { MarketplaceDocumentAdapter, MarketplaceFetchOutcome } from './types';

/** Internal fallback — builds a packing slip PDF from the order row we already have. */
export const generatedDocumentAdapter: MarketplaceDocumentAdapter = {
  platform: 'generated',

  canFetch() {
    return true;
  },

  async fetchDocument(
    order: OutboundOrderContext,
    type: OutboundDocumentType,
  ): Promise<MarketplaceFetchOutcome> {
    if (type !== 'packing_slip') {
      return {
        ok: false,
        error: 'Shipping labels must be uploaded manually or fetched from your carrier integration.',
      };
    }

    const platform = detectOutboundPlatform(order.accountSource);
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
      platform: 'generated',
      orderRef: order.orderRef,
      documentType: type,
      shipmentId: order.shipmentId,
    });

    return {
      ok: true,
      buffer,
      contentType: 'application/pdf',
      extension: 'pdf',
      filename: `packing-slip-${order.orderRef}.pdf`,
      platform,
      source: 'generated',
      tracking: order.tracking,
      carrier: order.carrier,
      sourceHash,
    };
  },
};
