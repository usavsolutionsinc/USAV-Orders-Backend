'use client';

/**
 * Main-area Racks workspace.
 *
 * Hosts the rack-level label printer — same picker scaffolding as the bin
 * label printer but without the position step. Each printed label
 * identifies a whole rack column on one level (zone/aisle/bay/level),
 * stored under the position=0 sentinel so scan routing can distinguish
 * rack scans from bin scans.
 */

import { RackLabelPrinter } from '@/components/barcode/RackLabelPrinter';

export function RackLabelWorkspace() {
  return (
    <div className="space-y-4">
      <RackLabelPrinter />
    </div>
  );
}
