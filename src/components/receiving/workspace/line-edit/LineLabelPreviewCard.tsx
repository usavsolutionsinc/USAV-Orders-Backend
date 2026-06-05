'use client';

import { WorkspaceCard } from '@/design-system/components';
import { ReceivingPoLabelPreview } from '../ReceivingPoLabelPreview';
import { ReceivingProductLabelPreview } from '../ReceivingProductLabelPreview';
import type { ReceivingLabelPayload } from '../receiving-label-helpers';

/**
 * Inline preview of the label that "Print · receive" will produce. Shows the
 * PO/receiving label when the carton has a scan value; otherwise falls back to
 * a product (SKU) label preview. Renders nothing when neither is available.
 */
export function LineLabelPreviewCard({
  scanValue,
  labelPayload,
  sku,
  itemName,
  serialNumber,
}: {
  scanValue: string;
  labelPayload: ReceivingLabelPayload;
  sku: string | null | undefined;
  itemName: string | null | undefined;
  serialNumber: string;
}) {
  if (!scanValue && !sku) return null;
  return (
    <WorkspaceCard>
      {scanValue ? (
        <ReceivingPoLabelPreview {...labelPayload} embedded />
      ) : sku ? (
        <ReceivingProductLabelPreview
          sku={sku}
          title={itemName ?? ''}
          serialNumber={serialNumber}
          embedded
        />
      ) : null}
    </WorkspaceCard>
  );
}
