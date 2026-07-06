import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Signals',
};

type SignalsRedirectPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Retired standalone route — Signals now lives under Operations as
 * `?mode=signals`. Preserves deep-links from the old `/signals` path.
 */
export default async function SignalsRedirectPage({ searchParams }: SignalsRedirectPageProps) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  sp.set('mode', 'signals');

  const legacyMode = String(params.mode ?? '');
  if (legacyMode === 'browse') sp.set('signalsView', 'browse');

  for (const key of ['window', 'signalKind', 'q', 'signalId'] as const) {
    const raw = params[key];
    if (!raw) continue;
    sp.set(key, Array.isArray(raw) ? raw[0]! : raw);
  }

  redirect(`/operations?${sp.toString()}`);
}
