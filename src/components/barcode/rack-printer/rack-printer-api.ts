import { rackToLocation, type RackSegments } from '@/lib/barcode-routing';

/**
 * Register rack rows (position=0) before printing so a scan of the printed QR
 * resolves to a real row in the locations table. Throws with a descriptive
 * message on failure.
 */
export async function registerRackLocations(room: string, labels: RackSegments[]): Promise<void> {
  const res = await fetch('/api/locations/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room,
      segments: labels.map(rackToLocation),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Registration failed (HTTP ${res.status})`);
  }
}
