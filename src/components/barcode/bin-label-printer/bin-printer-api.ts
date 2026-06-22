import type { LocationSegments } from '@/lib/barcode-routing';

/**
 * Register bin rows in the locations table before printing so scans of the
 * printed QR resolve to a real bin (putaway audits work, the bin shows in
 * bins-overview). Throws on failure — printing an orphan label is worse than not
 * printing.
 */
export async function registerLocations(room: string, segments: LocationSegments[]): Promise<void> {
  const res = await fetch('/api/locations/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, segments }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Registration failed (HTTP ${res.status})`);
  }
}
