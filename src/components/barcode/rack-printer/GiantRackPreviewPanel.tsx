import { Printer } from '@/components/Icons';
import { LocationDataMatrix } from '../LocationDataMatrix';
import { gs1LocationAi, rackCode, rackToLocation, type RackSegments } from '@/lib/barcode-routing';
import { humanReadable, partialCode } from './rack-code-format';

interface GiantRackPreviewPanelProps {
  zoneLetter?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  gln: string;
}

/**
 * Near-print-size rack preview for the desktop main pane — bigger code, larger
 * QR. Mirrors the bin printer's GiantPreviewPanel but with no position segment.
 */
export function GiantRackPreviewPanel({ zoneLetter, aisle, bay, level, gln }: GiantRackPreviewPanelProps) {
  const segments: RackSegments | null = zoneLetter && aisle != null && bay != null && level != null
    ? { zone: zoneLetter, aisle, bay, level }
    : null;
  const code = segments
    ? rackCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level });
  const ai = segments ? gs1LocationAi(rackToLocation(segments), { gln }) : null;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-micro font-bold uppercase tracking-[0.22em] text-gray-400">
            Live preview · prints at 3″ × 2″
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center">
          <div className="flex items-start gap-8 rounded-2xl border-2 border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50/50 p-8 shadow-inner">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-bold uppercase tracking-[0.18em] text-gray-500">
                USAV Warehouse Rack
              </p>
              <p className="mt-2 whitespace-nowrap font-mono text-4xl font-black leading-none tracking-tight text-gray-900">
                {code}
              </p>
              <p className="mt-2 text-label font-semibold leading-snug text-gray-600">
                {humanReadable({ zone: zoneLetter, aisle, bay, level })}
              </p>
            </div>
            <div className="flex h-[240px] w-[240px] shrink-0 items-center justify-center rounded-xl bg-white p-3 ring-1 ring-gray-200">
              {ai ? (
                <LocationDataMatrix value={ai} size={216} fgColor="#0F172A" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <Printer className="h-7 w-7 text-gray-300" />
                  <p className="px-4 text-caption font-semibold text-gray-400">
                    Barcode appears when every step is picked in the sidebar
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
