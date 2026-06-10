/**
 * Client helpers for camera-based product identify in the receiving flow.
 *
 * Same shape as src/lib/nas-photos.ts: the app is Vercel-hosted and can't reach the
 * LAN, so the BROWSER posts the captured frame DIRECT to the vision box (the RTX
 * 5070 Ti) over the LAN/Cloudflare. The full-res image never round-trips through
 * Vercel. The box returns ranked SKU candidates; we then ask the Vercel API to
 * enrich them against sku_catalog for display + pairing.
 *
 *   browser frame ──▶ {visionBaseUrl}/identify ──▶ [{ sku, score }]
 *                                                        │
 *                  /api/receiving/visual-identify ◀──────┘  (enrich + pair)
 */

// Runtime base URL of the vision box, seeded from GET /api/vision-config (mirrors
// setNasBaseUrl). No trailing slash.
let runtimeBase = (process.env.NEXT_PUBLIC_VISION_BASE_URL || '').replace(/\/+$/, '');

export function setVisionBaseUrl(url: string | null | undefined): void {
  runtimeBase = (url || '').replace(/\/+$/, '');
}

export function getVisionBaseUrl(): string {
  return runtimeBase;
}

export function visionConfigured(): boolean {
  return getVisionBaseUrl().length > 0;
}

/** Raw candidate from the vision box. */
export interface VisionCandidate {
  sku: string;
  score: number;
}

/** A candidate enriched against sku_catalog by /api/receiving/visual-identify. */
export interface EnrichedCandidate extends VisionCandidate {
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  /** True when the vision SKU resolved to a real sku_catalog row. */
  resolved: boolean;
}

export interface IdentifyResult {
  ok: boolean;
  candidates: VisionCandidate[];
  error?: string;
}

/**
 * Post a captured frame straight to the vision box. `credentials: 'include'` lets a
 * Cloudflare Access cookie ride along, exactly like the NAS PUT. The box must answer
 * the CORS preflight for the app origin.
 */
export async function identifyFromVisionBox(blob: Blob): Promise<IdentifyResult> {
  const base = getVisionBaseUrl();
  if (!base) return { ok: false, candidates: [], error: 'Vision service is not configured.' };

  const form = new FormData();
  form.append('file', blob, 'capture.jpg');

  let res: Response;
  try {
    res = await fetch(`${base}/identify`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      candidates: [],
      error:
        "Can't reach the vision service. Check you're on the office network and the " +
        'box is running (and served over HTTPS on the live site).',
    };
  }
  if (!res.ok) {
    return { ok: false, candidates: [], error: `Vision identify failed (HTTP ${res.status}).` };
  }
  const data = (await res.json().catch(() => null)) as { candidates?: VisionCandidate[] } | null;
  return { ok: true, candidates: Array.isArray(data?.candidates) ? data!.candidates : [] };
}

/**
 * Enrich raw vision candidates against sku_catalog (server-side, auth-guarded) so
 * the UI can show titles/images and pair the chosen one.
 */
export async function enrichCandidates(
  candidates: VisionCandidate[],
  receivingId: number,
): Promise<EnrichedCandidate[]> {
  if (candidates.length === 0) return [];
  const res = await fetch('/api/receiving/visual-identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiving_id: receivingId, candidates }),
  });
  if (!res.ok) return candidates.map((c) => ({ ...c, sku_catalog_id: null, product_title: null, image_url: null, resolved: false }));
  const data = (await res.json().catch(() => null)) as { candidates?: EnrichedCandidate[] } | null;
  return Array.isArray(data?.candidates) ? data!.candidates : [];
}

/**
 * One-shot convenience: frame → vision box → enriched candidates.
 */
export async function identifyAndEnrich(
  blob: Blob,
  receivingId: number,
): Promise<{ ok: boolean; candidates: EnrichedCandidate[]; error?: string }> {
  const result = await identifyFromVisionBox(blob);
  if (!result.ok) return { ok: false, candidates: [], error: result.error };
  const enriched = await enrichCandidates(result.candidates, receivingId);
  return { ok: true, candidates: enriched };
}
