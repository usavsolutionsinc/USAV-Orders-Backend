/**
 * Per-org photo-analysis provider resolution (pure, DB-free).
 *
 * The provider that runs when a photo is enriched into `photo_analysis` is a
 * PER-ORG choice (`organizations.settings.photoAnalysis.provider`), so a tenant
 * with its own RTX 5070 Ti vision box keeps every photo on-prem while another
 * tenant can opt into cloud GCP Vision or the text-only Hermes inference.
 *
 * Resolution precedence (most specific wins):
 *   1. the org's explicit setting        (the owner picked it in the UI)
 *   2. the PHOTOS_ANALYZE_PROVIDER env    (deployment-wide default)
 *   3. 'local-vision'                     (the LOCAL-FIRST product default)
 *
 * Keeping this pure (it takes the already-parsed settings + raw env strings, not
 * a DB handle or process.env) is what lets analyze.ts stay unit-testable with
 * zero database.
 */

import type { PhotoAnalysisSettings } from '@/lib/tenancy/settings';

/** The canonical provider vocabulary. `gcp-vision` = Google Cloud Vision (cloud). */
export type PhotoAnalyzeProvider = 'hermes' | 'gcp-vision' | 'local-vision' | 'catalog';

export const PHOTO_ANALYZE_PROVIDERS: readonly PhotoAnalyzeProvider[] = [
  'local-vision',
  'hermes',
  'gcp-vision',
  'catalog',
] as const;

/** Local-first: when nothing is configured anywhere, keep photos on the org's box. */
export const DEFAULT_PHOTO_ANALYZE_PROVIDER: PhotoAnalyzeProvider = 'local-vision';

/**
 * Coerce a raw string (UI value or env var) to a known provider, or null when it
 * isn't one. Accepts the legacy `'vision'` alias for `'gcp-vision'` so existing
 * PHOTOS_ANALYZE_PROVIDER=vision deployments keep meaning Google Cloud Vision.
 */
export function normalizeProvider(raw: string | null | undefined): PhotoAnalyzeProvider | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === '') return null;
  if (v === 'vision' || v === 'gcp' || v === 'gcp-vision' || v === 'google') return 'gcp-vision';
  if (v === 'local' || v === 'local-vision' || v === 'vision-box') return 'local-vision';
  if (v === 'hermes') return 'hermes';
  if (v === 'catalog' || v === 'off' || v === 'none') return 'catalog';
  return null;
}

/**
 * Resolve which provider should run for this org. `orgSettings` is the parsed
 * `photoAnalysis` block (or undefined); `envProvider` is the raw
 * PHOTOS_ANALYZE_PROVIDER value.
 */
export function resolvePhotoAnalyzeProvider(
  orgSettings: PhotoAnalysisSettings | undefined,
  envProvider: string | null | undefined,
): PhotoAnalyzeProvider {
  const fromOrg = normalizeProvider(orgSettings?.provider);
  if (fromOrg) return fromOrg;
  const fromEnv = normalizeProvider(envProvider);
  if (fromEnv) return fromEnv;
  return DEFAULT_PHOTO_ANALYZE_PROVIDER;
}

/**
 * Resolve whether analysis is enabled for this org. The per-org `enabled` flag
 * wins when set; otherwise the deployment-wide env switch decides.
 */
export function resolvePhotoAnalyzeEnabled(
  orgSettings: PhotoAnalysisSettings | undefined,
  envEnabled: boolean,
): boolean {
  if (typeof orgSettings?.enabled === 'boolean') return orgSettings.enabled;
  return envEnabled;
}
