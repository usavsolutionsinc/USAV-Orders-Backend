'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';

/**
 * Admin → Photo platform → AI analysis engine. Lets the org owner pick WHICH
 * inference path runs when a photo is enriched into photo_analysis — the local
 * RTX 5070 Ti box (photos stay on-prem), cloud GCP Vision, the Hermes text
 * gateway, or none. Reads/writes the per-org setting via
 * /api/admin/organization/settings (photoAnalysis). Local-first is the default.
 */

type Provider = 'local-vision' | 'hermes' | 'gcp-vision' | 'catalog';

interface PhotoAnalysisSettings {
  provider: Provider | null;
  enabled: boolean | null;
  localVisionBaseUrl: string;
}

interface SettingsResponse {
  photoAnalysis?: PhotoAnalysisSettings;
}

const OPTIONS: Array<{
  value: Provider;
  label: string;
  blurb: string;
  privacy: 'on-prem' | 'cloud' | 'local-text' | 'none';
}> = [
  {
    value: 'local-vision',
    label: 'Local vision box (RTX 5070 Ti)',
    blurb: 'OCR + product match on your own GPU. Photos never leave the building.',
    privacy: 'on-prem',
  },
  {
    value: 'hermes',
    label: 'Hermes (text gateway)',
    blurb: 'Infers metadata from PO context. No image leaves your gateway.',
    privacy: 'local-text',
  },
  {
    value: 'gcp-vision',
    label: 'Google Cloud Vision',
    blurb: 'Mature general OCR + labels. Photos are uploaded to Google.',
    privacy: 'cloud',
  },
  {
    value: 'catalog',
    label: 'Off (catalog only)',
    blurb: 'No model. Deterministic PO-derived metadata only.',
    privacy: 'none',
  },
];

const PRIVACY_CHIP: Record<string, string> = {
  'on-prem': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'local-text': 'bg-blue-50 text-blue-700 ring-blue-200',
  cloud: 'bg-amber-50 text-amber-700 ring-amber-200',
  none: 'bg-gray-50 text-gray-600 ring-gray-200',
};

const PRIVACY_LABEL: Record<string, string> = {
  'on-prem': 'On-prem',
  'local-text': 'Local',
  cloud: 'Cloud',
  none: 'None',
};

export function PhotoAnalysisProviderPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SettingsResponse>({
    queryKey: ['admin-org-settings', 'photoAnalysis'],
    queryFn: async () => {
      const res = await fetch('/api/admin/organization/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  // Local draft so the URL field is editable before saving. `null` provider = inherit
  // the deployment default (which is local-first).
  const [provider, setProvider] = useState<Provider>('local-vision');
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    const pa = data?.photoAnalysis;
    if (!pa) return;
    setProvider(pa.provider ?? 'local-vision');
    setEnabled(pa.enabled ?? false);
    setBaseUrl(pa.localVisionBaseUrl ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/organization/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoAnalysis: { provider, enabled, localVisionBaseUrl: baseUrl.trim() },
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success('Photo analysis engine saved');
      queryClient.invalidateQueries({ queryKey: ['admin-org-settings', 'photoAnalysis'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  if (isLoading) return <p className="text-sm text-gray-500">Loading analysis settings…</p>;
  if (error) {
    return (
      <p className="text-sm text-rose-600">
        {error instanceof Error ? error.message : 'Could not load analysis settings'}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-800">AI analysis engine</p>
          <p className="text-caption text-gray-500">
            Which model reads your photos when they&apos;re enriched for search and claims.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-caption font-semibold text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Enabled
        </label>
      </div>

      <ul className="mt-3 space-y-2">
        {OPTIONS.map((opt) => {
          const selected = provider === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => setProvider(opt.value)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  selected
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-inset ring-blue-400'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <span
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                    selected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-caption font-bold text-gray-900">{opt.label}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-inset ${
                        PRIVACY_CHIP[opt.privacy]
                      }`}
                    >
                      {PRIVACY_LABEL[opt.privacy]}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-caption text-gray-500">{opt.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {provider === 'local-vision' ? (
        <div className="mt-3 space-y-1">
          <label className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
            Vision box URL (server-reachable)
          </label>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://vision.yourdomain.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-caption text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <p className="text-caption text-gray-500">
            The Cloudflare-tunnel hostname of your box. The analysis cron runs in the cloud and
            can&apos;t reach the office LAN — this must be publicly reachable (the box checks
            the <code className="rounded bg-gray-100 px-1">x-vision-token</code> secret). Leave
            blank to use the deployment default.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-caption font-black uppercase tracking-widest text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save engine'}
        </button>
      </div>
    </div>
  );
}
