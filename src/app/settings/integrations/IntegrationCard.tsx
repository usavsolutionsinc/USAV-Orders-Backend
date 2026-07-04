'use client';

/**
 * Per-provider integration card. Renders a monogram badge, status pill, the
 * connected accounts, and an action set driven by the provider's `connect`
 * method (registry.ts):
 *   - amazon : region/OAuth/paste sheet + health + per-account disconnect
 *   - ebay   : OAuth connect (account label) + per-account token refresh
 *   - oauth  : single OAuth redirect (+ health) + vault disconnect
 *   - vault  : paste-JSON credential entry + disconnect
 */
import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import { Button } from '@/design-system/primitives/Button';
import { IconButton } from '@/design-system/primitives/IconButton';
import { RefreshCw, Trash2, ExternalLink, Link2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useAuth } from '@/contexts/AuthContext';
import type { ProviderDef, ProviderState, AccountSummary } from './registry';
import { monogram, managePermission } from './registry';
import { AmazonConnectModal } from './AmazonConnectModal';

const PILL: Record<ProviderState['status'], { dot: string; text: string; bg: string; label: string }> = {
  connected: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Connected' },
  error: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', label: 'Needs attention' },
  not_connected: { dot: 'bg-surface-strong', text: 'text-text-soft', bg: 'bg-surface-sunken', label: 'Not connected' },
};

const ACCOUNT_DOT: Record<AccountSummary['status'], string> = {
  active: 'bg-emerald-500',
  error: 'bg-red-500',
  expiring: 'bg-amber-500',
  revoked: 'bg-border-emphasis',
  unknown: 'bg-surface-strong',
};

export function IntegrationCard({ def, state, nangoReady, canSync }: { def: ProviderDef; state: ProviderState; nangoReady?: boolean; canSync?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [amazonOpen, setAmazonOpen] = useState(false);
  const [payload, setPayload] = useState('{}');
  const [formError, setFormError] = useState<string | null>(null);

  const auth = useAuth();
  const canManage = auth.isLoaded ? auth.has(managePermission(def)) : false;
  const pill = PILL[state.status];
  const connected = state.status !== 'not_connected';

  const runHealth = useCallback(async () => {
    if (!def.healthPath) return;
    setBusy(true);
    try {
      const res = await fetch(def.healthPath);
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && (data.ok ?? data.success);
      if (ok) {
        toast.success(`${def.label} connection healthy.`);
      } else {
        const detail = data.error || data.accounts?.find?.((a: { ok?: boolean; error?: string }) => !a.ok)?.error || 'health check failed';
        toast.error(`${def.label}: ${detail}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'health check failed');
    } finally {
      setBusy(false);
    }
  }, [def]);

  // Connection-driven "Sync now" — runs the connector's sync() server-side.
  const runSync = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/${def.key}/sync`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const bits = [
          data.imported ? `${data.imported} imported` : null,
          data.updated ? `${data.updated} updated` : null,
        ].filter(Boolean).join(', ');
        toast.success(`${def.label} synced${bits ? ` — ${bits}` : ''}.`);
      } else {
        toast.error(`${def.label} sync failed: ${data.error || `HTTP ${res.status}`}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'sync failed');
    } finally {
      setBusy(false);
    }
  }, [def]);

  const vaultSave = useCallback(async () => {
    setBusy(true);
    setFormError(null);
    try {
      const parsed = JSON.parse(payload);
      const res = await fetch('/api/admin/integrations/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: def.key, payload: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || `HTTP ${res.status}`);
        return;
      }
      toast.success(`${def.label} credentials saved.`);
      window.location.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'invalid JSON');
    } finally {
      setBusy(false);
    }
  }, [def, payload]);

  const vaultDisconnect = useCallback(async () => {
    if (!confirm(`Disconnect ${def.label}? Sync jobs will fail until reconnected.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/integrations/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: def.key }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Couldn't disconnect: ${data.error || res.status}`);
      } else {
        toast.success(`${def.label} disconnected.`);
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }, [def]);

  const oauthConnect = useCallback(() => {
    if (def.oauthStartPath) window.location.href = def.oauthStartPath;
  }, [def]);

  // Hosted Nango Connect UI (OAuth dance) — mirrors src/components/admin/IntegrationCard.
  const connectViaNango = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/nango/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: def.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error === 'NANGO_NOT_CONFIGURED' ? 'Nango is not configured on the server.' : data.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      const { default: Nango } = await import('@nangohq/frontend');
      const nango = new Nango();
      nango.openConnectUI({
        sessionToken: data.token,
        ...(process.env.NEXT_PUBLIC_NANGO_CONNECT_BASE_URL ? { baseURL: process.env.NEXT_PUBLIC_NANGO_CONNECT_BASE_URL } : {}),
        ...(process.env.NEXT_PUBLIC_NANGO_API_URL ? { apiURL: process.env.NEXT_PUBLIC_NANGO_API_URL } : {}),
        onEvent: async (event) => {
          if (event.type === 'connect') {
            const m = await fetch('/api/integrations/nango/connected', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                provider: def.key,
                providerConfigKey: event.payload.providerConfigKey,
                connectionId: event.payload.connectionId,
              }),
            });
            if (m.ok) {
              toast.success(`${def.label} connected.`);
              window.location.reload();
            } else {
              const md = await m.json().catch(() => ({}));
              toast.error(md.error || 'Failed to record connection');
            }
          } else if (event.type === 'error') {
            toast.error(event.payload.errorMessage || 'Connection failed');
          }
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  }, [def]);

  // role='seller' is the existing outbound path; role='buyer' connects a
  // PURCHASING account whose orders flow into Universal Incoming.
  const ebayConnect = useCallback((role: 'seller' | 'buyer' = 'seller') => {
    const peers = state.accounts.filter((a) => (a.role ?? 'seller') === role);
    const prefix = role === 'buyer' ? 'ebay-buyer' : 'ebay';
    const suggested = peers.length === 0 ? `${prefix}-main` : `${prefix}-${peers.length + 1}`;
    const kind = role === 'buyer' ? 'purchasing' : 'selling';
    const acct = window.prompt(`eBay ${kind} account label (e.g. ${suggested}):`, suggested);
    const label = acct?.trim();
    if (!label) return;
    if (state.accounts.some((a) => a.label.toLowerCase() === label.toLowerCase())) {
      toast.error(`An eBay account labeled "${label}" already exists — pick a different label, or reconnect it from its row.`);
      return;
    }
    const roleParam = role === 'buyer' ? '&role=buyer' : '';
    window.location.href = `${def.oauthStartPath}?accountName=${encodeURIComponent(label)}${roleParam}`;
  }, [def, state.accounts]);

  const ebayDisconnect = useCallback(async (id: number, label: string) => {
    if (!confirm(`Disconnect eBay account "${label}"? Its stored tokens will be removed.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ebay/accounts?id=${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        toast.success(`Disconnected ${label}.`);
        window.location.reload();
      } else if (res.status === 403 && data?.error === 'STEPUP_REQUIRED') {
        toast.error('Re-verification required to disconnect — please re-authenticate and retry.');
      } else {
        toast.error(data?.error || `Disconnect failed (HTTP ${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const ebayRefresh = useCallback(async (accountName: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/ebay/refresh-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) toast.success(`Refreshed ${accountName}.`);
      else toast.error(data?.error || `Refresh failed (HTTP ${res.status})`);
    } finally {
      setBusy(false);
    }
  }, []);

  const amazonDisconnect = useCallback(async (id: number, label: string) => {
    if (!confirm(`Disconnect Amazon account "${label}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/amazon/accounts?id=${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        toast.success(`Disconnected ${label}.`);
        window.location.reload();
      } else {
        toast.error(data?.error || `Disconnect failed (HTTP ${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const connectLabel = connected ? 'Reconnect' : 'Connect';

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border-soft bg-surface-card p-4 shadow-sm shadow-gray-900/[0.02]">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[14px] font-black ${def.badge}`}>
          {monogram(def.label)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-text-default">{def.label}</span>
            {def.docsUrl && (
              <HoverTooltip label="Provider docs" asChild>
                <a href={def.docsUrl} target="_blank" rel="noreferrer" aria-label="Provider docs" className="text-text-faint hover:text-text-soft">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </HoverTooltip>
            )}
          </div>
          <p className="mt-0.5 text-label leading-snug text-text-soft">{def.description}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full ${pill.bg} px-2 py-1 text-[10.5px] font-medium ${pill.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>
      </div>

      {/* Accounts */}
      {state.accounts.length > 0 && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-surface-canvas/70 p-2">
          {state.accounts.map((acct, i) => (
            <div key={acct.id ?? `${acct.label}-${i}`} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCOUNT_DOT[acct.status]}`} />
              <span className="min-w-0 flex-1 truncate text-label font-medium text-text-default">{acct.label}</span>
              {def.connect === 'ebay' && acct.role === 'buyer' && (
                <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-indigo-700 ring-1 ring-inset ring-indigo-200">Purchasing</span>
              )}
              {acct.detail && <span className="shrink-0 text-caption text-text-faint">{acct.detail}</span>}
              {canManage && def.connect === 'amazon' && acct.id != null && (
                <HoverTooltip label="Disconnect account" asChild>
                  <IconButton
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => amazonDisconnect(acct.id!, acct.label)}
                    disabled={busy}
                    ariaLabel="Disconnect account"
                    className="shrink-0 hover:text-red-600"
                  />
                </HoverTooltip>
              )}
              {canManage && def.connect === 'ebay' && (
                <HoverTooltip label="Refresh token" asChild>
                  <IconButton
                    icon={<RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />}
                    onClick={() => ebayRefresh(acct.label)}
                    disabled={busy}
                    ariaLabel="Refresh token"
                    tone="accent"
                    className="shrink-0"
                  />
                </HoverTooltip>
              )}
              {canManage && def.connect === 'ebay' && acct.id != null && (
                <HoverTooltip label="Disconnect account" asChild>
                  <IconButton
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => ebayDisconnect(acct.id!, acct.label)}
                    disabled={busy}
                    ariaLabel="Disconnect account"
                    className="shrink-0 hover:text-red-600"
                  />
                </HoverTooltip>
              )}
            </div>
          ))}
        </div>
      )}

      {state.displayLabel && state.accounts.length === 0 && (
        <div className="mt-2 text-label text-text-muted">{state.displayLabel}</div>
      )}
      {state.lastError && (
        <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-caption text-red-700">{state.lastError}</div>
      )}

      {/* Actions — pinned to the bottom so buttons align across cards in a row */}
      <div className="mt-auto flex items-center gap-2 border-t border-border-hairline pt-3">
        {!canManage ? (
          <span className="text-[11.5px] text-text-faint">Read-only — requires elevated access</span>
        ) : (
          <>
            {def.connect === 'amazon' && (
              <Button variant="primary" size="sm" icon={<Link2 />} onClick={() => setAmazonOpen(true)}>{connectLabel}</Button>
            )}
            {def.connect === 'ebay' && (
              <>
                <Button variant="primary" size="sm" icon={<Link2 />} onClick={() => ebayConnect('seller')}>{connected ? 'Add selling account' : 'Connect'}</Button>
                <Button variant="secondary" size="sm" icon={<Link2 />} onClick={() => ebayConnect('buyer')}>Add purchasing account</Button>
              </>
            )}
            {def.connect === 'oauth' && (
              <Button variant="primary" size="sm" icon={<Link2 />} onClick={oauthConnect}>{connectLabel}</Button>
            )}
            {def.connect === 'vault' && (
              <Button variant={connected ? 'secondary' : 'primary'} size="sm" onClick={() => { setPayload('{}'); setFormError(null); setVaultOpen(true); }}>
                {connected ? 'Update credentials' : 'Connect'}
              </Button>
            )}
            {def.connect === 'nango' && (
              nangoReady ? (
                <Button variant="primary" size="sm" icon={<Link2 />} loading={busy} onClick={connectViaNango}>
                  {connected ? 'Reconnect with OAuth' : 'Connect with OAuth'}
                </Button>
              ) : (
                <Button variant={connected ? 'secondary' : 'primary'} size="sm" onClick={() => { setPayload('{}'); setFormError(null); setVaultOpen(true); }}>
                  {connected ? 'Update credentials' : 'Connect'}
                </Button>
              )
            )}

            {def.healthPath && (
              <Button variant="secondary" size="sm" icon={<RefreshCw />} loading={busy} onClick={runHealth}>Check</Button>
            )}

            {canSync && (
              <Button variant="secondary" size="sm" icon={<RefreshCw />} loading={busy} onClick={runSync}>Sync now</Button>
            )}

            <span className="flex-1" />

            {connected && (def.connect === 'vault' || def.connect === 'oauth' || def.connect === 'nango') && (
              <Button variant="ghost" size="sm" onClick={vaultDisconnect} disabled={busy} className="text-text-soft hover:text-red-600">
                Disconnect
              </Button>
            )}
          </>
        )}
      </div>

      {/* Amazon connect sheet */}
      {amazonOpen && <AmazonConnectModal onClose={() => setAmazonOpen(false)} />}

      {/* Generic vault credential sheet */}
      {vaultOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center px-4">
          {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
          <button type="button" aria-label="Close" onClick={() => setVaultOpen(false)} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg rounded-2xl border border-border-soft bg-surface-card p-5 shadow-2xl">
            <h2 className="text-[16px] font-semibold text-text-default">{def.label} credentials</h2>
            <p className="mt-1 text-label text-text-soft">Paste the provider payload JSON. Stored encrypted in the workspace vault.</p>
            <textarea
              className="mt-3 block h-48 w-full rounded-xl border border-border-soft bg-surface-card p-3 font-mono text-label text-text-default shadow-inner focus:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-border-soft"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              spellCheck={false}
            />
            {formError && <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-caption font-medium text-red-700">{formError}</div>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setVaultOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={busy} onClick={vaultSave}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
