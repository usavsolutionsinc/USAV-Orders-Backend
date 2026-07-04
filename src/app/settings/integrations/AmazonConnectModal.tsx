'use client';

/**
 * Amazon SP-API connect sheet. Two paths:
 *   1. OAuth (multi-tenant) — redirects to Seller Central consent via
 *      /api/amazon/oauth/start (the standard path once the app is published).
 *   2. Paste a self-authorized refresh token — bootstrap for a single seller
 *      while the public app is in review (POST /api/amazon/connect verifies it
 *      against SP-API before saving).
 */
import { useState } from 'react';
import { toast } from '@/lib/toast';
import { Button } from '@/design-system/primitives/Button';
import { ExternalLink } from '@/components/Icons';

const REGIONS: Array<{ value: 'NA' | 'EU' | 'FE'; label: string }> = [
  { value: 'NA', label: 'North America (US/CA/MX/BR)' },
  { value: 'EU', label: 'Europe (UK/DE/FR/…/IN)' },
  { value: 'FE', label: 'Far East (JP/AU/SG)' },
];

export function AmazonConnectModal({ onClose }: { onClose: () => void }) {
  const [region, setRegion] = useState<'NA' | 'EU' | 'FE'>('NA');
  const [refreshToken, setRefreshToken] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOauth = () => {
    window.location.href = `/api/amazon/oauth/start?region=${region}`;
  };

  const connectPaste = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/amazon/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken.trim(), sellerId: sellerId.trim() || undefined, region }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || data?.detail || `HTTP ${res.status}`);
        return;
      }
      toast.success(`Amazon connected (${(data.marketplaces || []).length} marketplace(s)).`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center px-4">
      {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-border-soft bg-surface-card p-5 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-text-default">Connect Amazon</h2>
        <p className="mt-1 text-label text-text-soft">
          Choose the seller region, then authorize. Multi-tenant OAuth requires a published Selling-Partner app;
          until then, paste a self-authorized refresh token.
        </p>

        <label className="mt-4 block">
          <span className="text-caption font-semibold uppercase tracking-wide text-text-soft">Region</span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as 'NA' | 'EU' | 'FE')}
            className="mt-1 block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-[13px] text-text-default focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>

        <div className="mt-4">
          <Button variant="primary" size="md" icon={<ExternalLink />} onClick={startOauth} className="w-full">
            Authorize with Amazon (OAuth)
          </Button>
        </div>

        <div className="my-4 flex items-center gap-3 text-caption font-medium uppercase tracking-wide text-text-faint">
          <span className="h-px flex-1 bg-surface-strong" /> or paste a refresh token <span className="h-px flex-1 bg-surface-strong" />
        </div>

        <div className="space-y-2">
          <input
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            placeholder="LWA refresh token (Atzr|…)"
            className="block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 font-mono text-label text-text-default focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
            spellCheck={false}
          />
          <input
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            placeholder="Seller ID (optional)"
            className="block w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 text-label text-text-default focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
          />
        </div>

        {error && <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-caption font-medium text-red-700">{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!refreshToken.trim()} onClick={connectPaste}>
            Verify &amp; Connect
          </Button>
        </div>
      </div>
    </div>
  );
}
