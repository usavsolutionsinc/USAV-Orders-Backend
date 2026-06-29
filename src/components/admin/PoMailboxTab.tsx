'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { AlertTriangle, Check, Mail, RefreshCw, X } from '@/components/Icons';
import { PoMailboxPreviewPanel } from '@/components/po-gmail/PoMailboxPreviewPanel';
import { Button } from '@/design-system/primitives';

interface PoMailboxStatus {
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  scope: string | null;
  needsReconnect: boolean;
  needsReconnectReason: string | null;
}

export function PoMailboxTab() {
  const router = useRouter();
  const search = useSearchParams();

  const [status, setStatus] = useState<PoMailboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/po-gmail/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as PoMailboxStatus);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load PO mailbox status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Surface ?po_gmail_connected=1 / ?po_gmail_error=... flash messages from the OAuth callback.
  useEffect(() => {
    const connected = search.get('po_gmail_connected');
    const error = search.get('po_gmail_error');
    if (connected === '1') {
      toast.success('PO mailbox connected');
      // strip the query param so a refresh doesn't re-toast
      router.replace('/admin?section=po_mailbox');
    } else if (error) {
      toast.error(`Connect failed: ${error}`);
      router.replace('/admin?section=po_mailbox');
    }
  }, [search, router]);

  const handleConnect = () => {
    // Server route issues a 302 to Google; full-page nav keeps the OAuth state cookie usable.
    window.location.href = '/api/admin/po-gmail/connect';
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect the PO mailbox? You will need to re-authorize to scan emails.')) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/admin/po-gmail/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('PO mailbox disconnected');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="h-full overflow-auto bg-gray-50">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start gap-3">
        <div className="rounded-md bg-blue-50 p-2 text-blue-600">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">PO Mailbox</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Dedicated Gmail account scanned for purchase-order emails. Connect once; refresh tokens
            are stored server-side and rotated automatically.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-900">Connection</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          {status?.connected ? (
            <>
              <StatusRow
                ok={!status.needsReconnect}
                label={status.needsReconnect ? 'Needs reconnect' : 'Connected'}
                detail={status.accountEmail ?? '(account email unavailable)'}
              />
              {status.connectedAt && (
                <p className="text-label text-gray-500">
                  Connected {new Date(status.connectedAt).toLocaleString()}
                </p>
              )}
              {status.needsReconnect && status.needsReconnectReason && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-label text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-medium">Refresh token rejected</div>
                    <div className="mt-0.5 break-all">{status.needsReconnectReason}</div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="secondary" icon={<RefreshCw />} onClick={handleConnect}>
                  Reconnect
                </Button>
                <Button
                  variant="secondary"
                  icon={<X />}
                  loading={disconnecting}
                  disabled={disconnecting}
                  onClick={handleDisconnect}
                  className="border border-red-200 text-red-600 hover:bg-red-50"
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <StatusRow ok={false} label="Not connected" detail="No mailbox has been authorized yet." />
              <Button variant="primary" icon={<Mail />} onClick={handleConnect}>
                Connect PO mailbox
              </Button>
              <p className="text-label text-gray-500">
                You&apos;ll be redirected to Google to sign in as the dedicated PO email account and approve
                the <code className="rounded bg-gray-100 px-1 py-0.5">gmail.modify</code> scope.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-900">Scope &amp; storage</h2>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-[140px_1fr]">
          <dt className="text-gray-500">Scope granted</dt>
          <dd className="text-gray-900 break-all">{status?.scope ?? '—'}</dd>
          <dt className="text-gray-500">Refresh token</dt>
          <dd className="text-gray-900">Stored in <code className="rounded bg-gray-100 px-1 py-0.5">google_oauth_tokens</code> (provider=&apos;po_gmail&apos;)</dd>
          <dt className="text-gray-500">Client credentials</dt>
          <dd className="text-gray-900">Read from <code className="rounded bg-gray-100 px-1 py-0.5">PO_GMAIL_CLIENT_ID</code> / <code className="rounded bg-gray-100 px-1 py-0.5">PO_GMAIL_CLIENT_SECRET</code> env vars</dd>
        </dl>
      </section>

      {status?.connected && <PoMailboxPreviewPanel />}
      </div>
    </div>
  );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="truncate text-label text-gray-500">{detail}</div>
      </div>
    </div>
  );
}
