import type { OutboundDocumentType } from '@/lib/documents/types';
import type { OutboundOrderContext } from './order-context';

export interface MarketplaceFetchResult {
  ok: true;
  buffer: Buffer;
  contentType: string;
  extension: string;
  filename: string;
  platform: string;
  source: string;
  tracking?: string | null;
  carrier?: string | null;
  sourceHash: string;
}

export interface MarketplaceFetchFailure {
  ok: false;
  error: string;
}

export type MarketplaceFetchOutcome = MarketplaceFetchResult | MarketplaceFetchFailure;

export interface MarketplaceDocumentAdapter {
  platform: string;
  canFetch(order: OutboundOrderContext): boolean;
  fetchDocument(
    order: OutboundOrderContext,
    type: OutboundDocumentType,
    orgId: string,
  ): Promise<MarketplaceFetchOutcome>;
}
