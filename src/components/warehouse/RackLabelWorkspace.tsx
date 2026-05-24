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
import { PageHeader } from '@/components/ui/pane-header';

export function RackLabelWorkspace() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Rack labels" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <RackLabelPrinter />
      </div>
    </div>
  );
}
