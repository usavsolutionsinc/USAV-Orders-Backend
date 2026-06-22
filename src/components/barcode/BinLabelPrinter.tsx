'use client';

/**
 * Location (bin) Label Printer. Five-step location builder (zone → aisle → bay →
 * level → position) that outputs a QR-only thermal label. Lives inside
 * LabelPrintWorkspace; rooms are a read-only input (CRUD lives in RoomsBoard).
 *
 * Thin composition layer — state/logic live in `./bin-label-printer`.
 */

import { Printer } from '@/components/Icons';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import { locationCode } from '@/lib/barcode-routing';
import { LabelRoomSidebar } from './LabelRoomSidebar';
import { ConfigSheet, PrintLabel, type LabelPrinterVariant } from './bin-label-printer';
import { useBinLabelPrinter } from './bin-label-printer/useBinLabelPrinter';
import { BinBuilderMobile } from './bin-label-printer/BinBuilderMobile';
import { BinBuilderDesktop } from './bin-label-printer/BinBuilderDesktop';
import { LivePreviewBody } from './bin-label-printer/LivePreviewBody';

export type { LabelPrinterVariant } from './bin-label-printer';

interface BinLabelPrinterProps {
  variant?: LabelPrinterVariant;
}

export function BinLabelPrinter({ variant = 'main' }: BinLabelPrinterProps) {
  const c = useBinLabelPrinter();

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
          emptySubtitle="Then build the bin code on the right."
        />
        <ConfigSheet open={c.configOpen} onClose={() => c.setConfigOpen(false)} config={c.config} onSave={c.handleConfigSave} />
      </>
    );
  }

  // ── Main-pane variant ───────────────────────────────────────────────────
  return (
    // flex-1 + min-h-0 lets this column fill the LabelPrintWorkspace height;
    // mt-auto on the StickyActionBar pins it to the bottom of the page.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="lg:hidden">
        <BinBuilderMobile c={c} variant={variant} />
      </div>

      {(c.selectedRoom || c.aisle != null) && (
        <WorkspaceCard label="Live preview" className="lg:hidden">
          <LivePreviewBody
            zoneLetter={c.zoneLetter}
            roomName={c.selectedRoom}
            aisle={c.aisle}
            bay={c.bay}
            level={c.level}
            position={c.position}
            gln={c.config.gln}
          />
        </WorkspaceCard>
      )}

      <div className="hidden lg:block">
        <BinBuilderDesktop c={c} />
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
                : 'Print bin label',
          onClick: c.handlePrintOne,
          disabled: !c.allSelected || c.isPrinting || c.missingLetter,
          isLoading: c.isPrinting,
          tone: 'blue',
          icon: <Printer className="h-4 w-4" />,
        }}
        secondary={
          c.allSelected
            ? {
                label: `Print level (×${c.config.maxPositions})`,
                onClick: c.handlePrintBulk,
                icon: <Printer className="h-4 w-4" />,
                disabled: c.isPrinting || c.missingLetter,
              }
            : undefined
        }
        hints={c.allSelected ? [{ key: '⌘P', label: 'Print' }] : []}
      />

      {/* Print zone — hidden on screen, fills page on print */}
      <div className="label-print-zone">
        {c.bulkLabels?.map((seg, i) => (
          <PrintLabel key={`${locationCode(seg)}-${i}`} segments={seg} roomName={c.selectedRoom ?? ''} gln={c.config.gln} />
        ))}
      </div>
    </div>
  );
}
