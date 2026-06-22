'use client';

/**
 * Rack Label Printer — four-step location builder (zone → aisle → bay → level)
 * that outputs a QR-only thermal label identifying a whole rack column on one
 * level. Sibling of {@link BinLabelPrinter}; same room/zone source of truth and
 * GS1 Digital Link envelope, but no position segment. Every rack label is stored
 * as a `LocationSegments` row with `position: 0` — the sentinel scan routing uses
 * to tell a rack scan from a bin scan (see `isRackCode`).
 *
 * Thin composition layer — state/logic live in `./rack-printer/`.
 */

import { Printer } from '@/components/Icons';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import { rackCode } from '@/lib/barcode-routing';
import { LabelRoomSidebar } from './LabelRoomSidebar';
import { useRackLabelPrinter } from './rack-printer/useRackLabelPrinter';
import { RackBuilderMobile } from './rack-printer/RackBuilderMobile';
import { RackBuilderDesktop } from './rack-printer/RackBuilderDesktop';
import { LivePreviewBody } from './rack-printer/LivePreviewBody';
import { ConfigSheet } from './rack-printer/ConfigSheet';
import { RackPrintLabel } from './rack-printer/RackPrintLabel';
import type { RackPrinterVariant } from './rack-printer/rack-printer-types';

export type { RackPrinterVariant } from './rack-printer/rack-printer-types';

interface RackLabelPrinterProps {
  variant?: RackPrinterVariant;
}

export function RackLabelPrinter({ variant = 'main' }: RackLabelPrinterProps) {
  const c = useRackLabelPrinter();

  // ── Sidebar variant — rooms list only ──────────────────────────────────
  if (variant === 'sidebar') {
    return (
      <>
        <LabelRoomSidebar
          rooms={c.allRoomNames}
          zoneMap={c.zoneMap}
          loading={c.loading}
          selectedRoom={c.selectedRoom}
          zoneLetter={c.zoneLetter}
          onSelect={c.pickRoom}
          emptySubtitle="Then drill into aisle, bay, and level on the right."
        />
        <ConfigSheet open={c.configOpen} onClose={() => c.setConfigOpen(false)} config={c.config} onSave={c.handleConfigSave} />
      </>
    );
  }

  // ── Main-pane variant ───────────────────────────────────────────────────
  return (
    // flex-1 + min-h-0 lets this fill the RackLabelWorkspace height; mt-auto on
    // the StickyActionBar pins it to the bottom of the page.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="lg:hidden">
        <RackBuilderMobile c={c} variant={variant} />
      </div>

      {(c.selectedRoom || c.aisle != null) && (
        <WorkspaceCard label="Live preview" className="lg:hidden">
          <LivePreviewBody
            zoneLetter={c.zoneLetter}
            roomName={c.selectedRoom}
            aisle={c.aisle}
            bay={c.bay}
            level={c.level}
            gln={c.config.gln}
          />
        </WorkspaceCard>
      )}

      <div className="hidden lg:block">
        <RackBuilderDesktop c={c} />
      </div>

      <StickyActionBar
        // Receiving-page parity: negative margins cancel the /warehouse page's
        // px-4 py-6 sm:px-6 gutter so the bar spans edge-to-edge and sits flush
        // against the scroll-container floor.
        className="mt-auto -mx-4 -mb-6 sm:-mx-6"
        primary={{
          label: c.isPrinting
            ? 'Printing…'
            : c.missingLetter
              ? 'Assign a zone letter first'
              : !c.allSelected
                ? 'Complete the steps'
                : 'Print rack label',
          onClick: c.handlePrintOne,
          disabled: !c.allSelected || c.isPrinting || c.missingLetter,
          isLoading: c.isPrinting,
          tone: 'blue',
          icon: <Printer className="h-4 w-4" />,
        }}
        secondary={
          c.selectedRoom && c.aisle != null && c.bay != null
            ? {
                label: `Print bay (×${c.config.maxLevels} levels)`,
                onClick: c.handlePrintBay,
                icon: <Printer className="h-4 w-4" />,
                disabled: c.isPrinting || c.missingLetter,
              }
            : undefined
        }
        hints={c.allSelected ? [{ key: '⌘P', label: 'Print' }] : []}
      />

      <div className="label-print-zone">
        {c.bulkLabels?.map((seg, i) => (
          <RackPrintLabel key={`${rackCode(seg)}-${i}`} segments={seg} roomName={c.selectedRoom ?? ''} gln={c.config.gln} />
        ))}
      </div>
    </div>
  );
}
