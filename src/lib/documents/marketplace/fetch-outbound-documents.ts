import 'server-only';

import type { OrgId } from '@/lib/tenancy/constants';
import {
  storeOutboundDocumentFromBytes,
  type FetchOutboundDocumentsResult,
} from '@/lib/documents/outbound-documents';
import type { OutboundDocumentType } from '@/lib/documents/types';
import { loadOutboundOrderContext } from './order-context';
import { ebayDocumentAdapter } from './ebay-documents';
import { generatedDocumentAdapter } from './generated-documents';
import type { MarketplaceDocumentAdapter } from './types';

const ADAPTERS: MarketplaceDocumentAdapter[] = [ebayDocumentAdapter, generatedDocumentAdapter];

function adapterForOrder(
  order: NonNullable<Awaited<ReturnType<typeof loadOutboundOrderContext>>>,
): MarketplaceDocumentAdapter {
  for (const adapter of ADAPTERS) {
    if (adapter.platform !== 'generated' && adapter.canFetch(order)) return adapter;
  }
  return generatedDocumentAdapter;
}

/**
 * Marketplace fetch orchestrator (docs/outbound-documents-plan.md §11.3).
 * Tries a platform adapter first; falls back to generated packing slips.
 */
export async function runMarketplaceDocumentFetch(
  orgId: OrgId,
  orderId: number,
  types: OutboundDocumentType[],
): Promise<FetchOutboundDocumentsResult> {
  const order = await loadOutboundOrderContext(orgId, orderId);
  if (!order) {
    return {
      fetched: [],
      failed: types.map((type) => ({ type, error: 'Order not found' })),
    };
  }

  const adapter = adapterForOrder(order);
  const fetched: FetchOutboundDocumentsResult['fetched'] = [];
  const failed: FetchOutboundDocumentsResult['failed'] = [];

  for (const type of types) {
    let outcome = await adapter.fetchDocument(order, type, orgId);

    if (!outcome.ok && type === 'packing_slip' && adapter.platform !== 'generated') {
      outcome = await generatedDocumentAdapter.fetchDocument(order, type, orgId);
    }

    if (!outcome.ok) {
      failed.push({ type, error: outcome.error });
      continue;
    }

    try {
      const stored = await storeOutboundDocumentFromBytes(orgId, {
        orderId: order.id,
        orderRef: order.orderRef,
        documentType: type,
        platform: outcome.platform,
        source: outcome.source,
        buffer: outcome.buffer,
        contentType: outcome.contentType,
        extension: outcome.extension,
        filename: outcome.filename,
        tracking: outcome.tracking ?? order.tracking,
        carrier: outcome.carrier ?? order.carrier,
        sourceHash: outcome.sourceHash,
      });
      fetched.push(stored.document);
    } catch (error) {
      failed.push({
        type,
        error: error instanceof Error ? error.message : 'Failed to store document',
      });
    }
  }

  return { fetched, failed };
}
