import { Printer } from '@/components/Icons';
import { LocationDataMatrix } from '../LocationDataMatrix';
import { gs1LocationAi, rackCode, rackToLocation, type RackSegments } from '@/lib/barcode-routing';
import { humanReadable, partialCode } from './rack-code-format';
import { useAuth } from '@/contexts/AuthContext';
import { orgWarehouseLabel } from '@/lib/branding/letterhead';

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
  const { user } = useAuth();
  const segments: RackSegments | null = zoneLetter && aisle != null && bay != null && level != null
    ? { zone: zoneLetter, aisle, bay, level }
    : null;
  const code = segments
    ? rackCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level });
  const ai = segments ? gs1LocationAi(rackToLocation(segments), { gln }) : null;

  return (
    <div className="rounded-3xl border border-border-soft bg-surface-card p-8 shadow-sm">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-micro font-bold uppercase tracking-[0.22em] text-text-faint">
            Live preview · prints at 3″ × 2″
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center">
          <div className="flex items-start gap-8 rounded-2xl border-2 border-dashed border-border-soft bg-gradient-to-br from-white to-gray-50/50 p-8 shadow-inner">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-bold uppercase tracking-[0.18em] text-text-soft">
                {orgWarehouseLabel(user?.organizationName || 'Workspace', 'Rack')}
              </p>
              <p className="mt-2 whitespace-nowrap font-mono text-4xl font-black leading-none tracking-tight text-text-default">
                {code}
              </p>
              <p className="mt-2 text-label font-semibold leading-snug text-text-muted">
                {humanReadable({ zone: zoneLetter, aisle, bay, level })}
              </p>
            </div>
            <div className="flex h-[240px] w-[240px] shrink-0 items-center justify-center rounded-xl bg-surface-card p-3 ring-1 ring-border-soft">
              {ai ? (
                <LocationDataMatrix value={ai} size={216} fgColor="#0F172A" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <Printer className="h-7 w-7 text-text-faint" />
                  <p className="px-4 text-caption font-semibold text-text-faint">
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
