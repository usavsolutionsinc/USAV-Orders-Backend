/**
 * Server-side client for the org's local vision box (the RTX 5070 Ti) photo
 * `/analyze` endpoint.
 *
 * IMPORTANT — reachability: the photo-analysis cron runs on Vercel (server-side),
 * which CANNOT reach the office LAN. So unlike the browser identify flow
 * (`src/lib/vision-identify.ts`, which POSTs from the operator's browser to the
 * LAN `NEXT_PUBLIC_VISION_BASE_URL`), this path needs a SERVER-reachable URL — the
 * box's Cloudflare-tunnel hostname — plus the `x-vision-token` shared secret the
 * box checks (`vision/app/server.py:_check_token`). Resolution:
 *   org `photoAnalysis.localVisionBaseUrl`  →  env VISION_ANALYZE_BASE_URL  →  env NEXT_PUBLIC_VISION_BASE_URL
 *
 * Every failure mode (not configured, unreachable, HTTP error, bad JSON) returns
 * null so the orchestrator degrades to the catalog fallback rather than throwing —
 * a single consumer GPU box must never 500 the analyze job.
 */

import type { PhotoAnalysisMetadata } from './analyze-types';
import { DAMAGE_KEYWORDS } from './analyze-types';
import type { PhotoAnalysisSettings } from '@/lib/tenancy/settings';

export interface LocalVisionConfig {
  /** Base URL of the vision box, server-reachable, no trailing slash. */
  baseUrl: string;
  /** Shared secret sent as `x-vision-token` (empty when the box has no token set). */
  token: string;
}

/** Injection seam so tests run without a real fetch / box. */
export interface LocalVisionDeps {
  fetchImpl: typeof fetch;
}

const defaultDeps: LocalVisionDeps = { fetchImpl: fetch };

function stripTrailingSlash(u: string): string {
  return (u || '').trim().replace(/\/+$/, '');
}

/**
 * Resolve the box URL + token for an org. Returns null when no base URL is
 * configured anywhere (so the caller can skip the provider cleanly).
 */
export function resolveLocalVisionConfig(
  settings: PhotoAnalysisSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): LocalVisionConfig | null {
  const baseUrl =
    stripTrailingSlash(settings?.localVisionBaseUrl || '') ||
    stripTrailingSlash(env.VISION_ANALYZE_BASE_URL || '') ||
    stripTrailingSlash(env.NEXT_PUBLIC_VISION_BASE_URL || '');
  if (!baseUrl) return null;
  return { baseUrl, token: (env.VISION_TOKEN || '').trim() };
}

/** The raw JSON the box's /analyze returns (defensive — every field optional). */
interface RawAnalyzeResponse {
  ocr_text?: unknown;
  labels?: unknown;
  damage_detected?: unknown;
  damage_notes?: unknown;
  caption?: unknown;
}

function toStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);
}

/**
 * Normalize the box response into PhotoAnalysisMetadata. Exported so it can be
 * unit-tested directly and so damage is derived consistently: the box may set
 * `damage_detected`, but we also OR-in a keyword scan of the OCR/labels so a box
 * that only does OCR still flags an obviously damaged carton.
 */
export function normalizeLocalVisionResponse(raw: RawAnalyzeResponse): PhotoAnalysisMetadata {
  const ocr_text = toStringArray(raw.ocr_text, 20);
  const labels = toStringArray(raw.labels, 12);

  const haystack = [...ocr_text, ...labels].join(' ').toLowerCase();
  const matchedKeywords = DAMAGE_KEYWORDS.filter((k) => haystack.includes(k));
  const damage_detected = raw.damage_detected === true || matchedKeywords.length > 0;

  let damage_notes: string | null = null;
  if (typeof raw.damage_notes === 'string' && raw.damage_notes.trim()) {
    damage_notes = raw.damage_notes.trim();
  } else if (matchedKeywords.length > 0) {
    damage_notes = matchedKeywords.join(', ');
  }

  const caption =
    typeof raw.caption === 'string' && raw.caption.trim()
      ? raw.caption.trim()
      : labels.slice(0, 3).join(', ') || ocr_text[0] || 'Operations photo';

  return { ocr_text, labels, damage_detected, damage_notes, caption };
}

/**
 * POST the photo bytes to the org's vision box `/analyze`. Returns enriched
 * metadata, or null on any failure (not configured / unreachable / non-OK /
 * unparseable) so the orchestrator falls through to the next provider.
 */
export async function analyzeWithLocalVision(
  buffer: Buffer,
  config: LocalVisionConfig | null,
  filename = 'photo.jpg',
  deps: LocalVisionDeps = defaultDeps,
): Promise<PhotoAnalysisMetadata | null> {
  if (!config?.baseUrl) return null;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)]), filename);

  const headers: Record<string, string> = {};
  if (config.token) headers['x-vision-token'] = config.token;

  let res: Response;
  try {
    res = await deps.fetchImpl(`${config.baseUrl}/analyze`, {
      method: 'POST',
      body: form,
      headers,
      cache: 'no-store',
    });
  } catch (err) {
    console.warn(
      '[photo-analyze] local vision box unreachable:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  if (!res.ok) {
    console.warn(`[photo-analyze] local vision /analyze failed (HTTP ${res.status}).`);
    return null;
  }

  const raw = (await res.json().catch(() => null)) as RawAnalyzeResponse | null;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeLocalVisionResponse(raw);
}
