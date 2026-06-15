'use client';

/**
 * Shows the outcome of an OAuth round-trip. The provider callbacks redirect back
 * to /settings/integrations?success=…|error=… ; this fires a toast, renders a
 * dismissible inline banner, and strips the query params so a refresh is quiet.
 */
import { useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { Check, AlertTriangle, X } from '@/components/Icons';

const SUCCESS: Record<string, string> = {
  amazon_connected: 'Amazon connected.',
  ebay_connected: 'eBay connected.',
  zoho_connected: 'Zoho connected.',
};

const ERRORS: Record<string, string> = {
  amazon_missing_oauth_params: 'Amazon sign-in returned no authorization code — please retry.',
  amazon_invalid_oauth_state: 'The Amazon connection link was invalid — please retry.',
  amazon_incomplete_oauth_state: 'The Amazon connection link was incomplete — please retry.',
  amazon_oauth_state_expired: 'The Amazon connection link expired — please retry.',
  amazon_server_configuration: 'The Amazon app is not fully configured on the server.',
  amazon_callback_failed: 'Amazon connection failed — please retry.',
  // eBay
  ebay_consent_declined: 'eBay sign-in was cancelled.',
  ebay_missing_oauth_params: 'eBay sign-in returned no authorization code — please retry.',
  ebay_invalid_oauth_state: 'The eBay connection link was invalid — please retry.',
  ebay_incomplete_oauth_state: 'The eBay connection link was incomplete — please retry.',
  ebay_oauth_state_expired: 'The eBay connection link expired — please retry.',
  ebay_server_configuration: 'The eBay app is not fully configured on the server.',
  ebay_token_exchange_failed: 'Token exchange with eBay failed — please retry.',
  ebay_callback_failed: 'eBay connection failed — please retry.',
  missing_oauth_params: 'Sign-in returned no authorization code — please retry.',
  token_exchange_failed: 'Token exchange with the provider failed — please retry.',
};

export function ResultBanner({ success, error }: { success?: string; error?: string }) {
  const [dismissed, setDismissed] = useState(false);
  const successMsg = success ? SUCCESS[success] ?? 'Connected.' : null;
  const errorMsg = error ? ERRORS[error] ?? 'The connection could not be completed.' : null;

  useEffect(() => {
    if (successMsg) toast.success(successMsg);
    else if (errorMsg) toast.error(errorMsg);
    if (successMsg || errorMsg) {
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [successMsg, errorMsg]);

  if (dismissed || (!successMsg && !errorMsg)) return null;
  const ok = !!successMsg;

  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="flex-1 text-[12.5px] font-medium">{successMsg ?? errorMsg}</span>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
