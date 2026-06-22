import { Printer } from '@/components/Icons';
import { LocationDataMatrix } from '../LocationDataMatrix';
import { gs1LocationAi, rackCode, rackToLocation, type RackSegments } from '@/lib/barcode-routing';
import { humanReadable, partialCode } from './rack-code-format';

interface LivePreviewBodyProps {
  zoneLetter?: string;
  roomName?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  gln: string;
}

/** Compact live preview (mobile): rack code + breakdown + QR. */
export function LivePreviewBody({ zoneLetter, roomName, aisle, bay, level, gln }: LivePreviewBodyProps) {
  const all = zoneLetter && aisle != null && bay != null && level != null;
  const segments: RackSegments | null = all
    ? { zone: zoneLetter!, aisle: aisle!, bay: bay!, level: level! }
    : null;
  const code = segments
    ? rackCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level });

  return (
    <div className="flex items-center gap-5 rounded-xl bg-gray-50 p-5 ring-1 ring-gray-200/50">
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Rack code</p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-2xl font-black tracking-tight text-gray-900">{code}</p>
        </div>
        {roomName && (
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Room</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-gray-800">{roomName}</p>
          </div>
        )}
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Breakdown</p>
          <p className="mt-0.5 text-label leading-snug text-gray-700">
            {humanReadable({ zone: zoneLetter, aisle, bay, level })}
          </p>
        </div>
      </div>
      <div className="flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-lg bg-white p-2 ring-1 ring-gray-200">
        {segments ? (
          <LocationDataMatrix
            value={gs1LocationAi(rackToLocation(segments), { gln })}
            size={144}
            fgColor="#0F172A"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
            <Printer className="h-5 w-5 text-gray-300" />
            <p className="px-2 text-micro font-semibold text-gray-400">
              Barcode appears when all steps are picked
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
