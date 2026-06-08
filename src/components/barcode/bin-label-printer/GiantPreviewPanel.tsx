'use client';

import { Printer } from '@/components/Icons';
import { LocationDataMatrix } from '../LocationDataMatrix';
import {
  gs1LocationAi,
  locationCode,
  type LocationSegments,
} from '@/lib/barcode-routing';
import { humanReadable, partialCode } from './utils';

interface GiantPreviewPanelProps {
  zoneLetter?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
  gln: string;
}

/**
 * Desktop main-pane preview rendered when the picker is in the sidebar.
 * Renders the label at near-actual size to telegraph what will print.
 */
export function GiantPreviewPanel({
  zoneLetter,
  aisle,
  bay,
  level,
  position,
  gln,
}: GiantPreviewPanelProps) {
  const segments: LocationSegments | null =
    zoneLetter && aisle != null && bay != null && level != null && position != null
      ? { zone: zoneLetter, aisle, bay, level, position }
      : null;
  const code = segments
    ? locationCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level, position });
  const ai = segments ? gs1LocationAi(segments, { gln }) : null;

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
                USAV Warehouse Location
              </p>
              <p className="mt-2 whitespace-nowrap font-mono text-3xl font-black leading-none tracking-tight text-gray-900">
                {code}
              </p>
              <p className="mt-2 text-label font-semibold leading-snug text-gray-600">
                {humanReadable({ zone: zoneLetter, aisle, bay, level, position })}
              </p>
            </div>
            <div className="flex h-[220px] w-[220px] shrink-0 items-center justify-center rounded-xl bg-white p-3 ring-1 ring-gray-200">
              {ai ? (
                <LocationDataMatrix value={ai} size={196} fgColor="#0F172A" />
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
