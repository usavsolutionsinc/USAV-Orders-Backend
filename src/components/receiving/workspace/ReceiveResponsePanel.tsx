'use client';

import { ChevronDown, X } from '@/components/Icons';
import { toast } from '@/lib/toast';

/* ──────────────────────────────────────────────────────────────────────────
 * ReceiveResponsePanel
 *
 * Surfaces the last POST /api/receiving/mark-received-po response below the
 * print preview so operators can see WHY a Zoho receive succeeded, was
 * skipped, or failed. The previous toast-only UX hid critical details
 * (especially "Zoho attempted: 0" — the no-PO-link case — which silently
 * fell through to a generic "Line received" success toast).
 *
 * Verdict mapping (mirrors the server's error_kind taxonomy):
 *   ✓ success      — zoho.attempted ≥ 1, zoho.ok = true, zoho.error null
 *   ⚠ skipped      — zoho.attempted === 0  (no linked PO/line item ids;
 *                                            local DB updated, Zoho untouched)
 *   ✗ rate_limit   — Zoho daily API quota exhausted
 *   ✗ circuit_open — internal circuit breaker tripped from recent failures
 *   ✗ api          — Zoho rejected the request (4xx/5xx with a Zoho code)
 *   ✗ other        — unexpected error / network failure
 *   ✓ verified     — dashboard already DONE but Zoho GET confirms fully received
 *                    (skip_reason zoho_already_fully_received; receive_id null)
 * ────────────────────────────────────────────────────────────────────────── */

export type ReceiveResponsePanelProps = {
  response: {
    at: number;
    durationMs: number;
    httpStatus: number;
    ok: boolean;
    body: unknown;
    networkError?: string;
  };
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
};

type ZohoResultRow = {
  purchaseorder_id?: string;
  receive_id?: string | null;
  error?: string | null;
  error_kind?: 'rate_limit' | 'circuit_open' | 'api' | 'other' | null;
};

export function classifyReceiveResponse(r: ReceiveResponsePanelProps['response']): {
  verdict: 'success' | 'skipped' | 'rate_limit' | 'circuit_open' | 'api_error' | 'http_error' | 'network';
  headline: string;
  detail: string;
  tone: 'emerald' | 'amber' | 'rose';
} {
  if (r.networkError) {
    return {
      verdict: 'network',
      headline: 'Network error',
      tone: 'rose',
      detail: r.networkError,
    };
  }
  const body = (r.body || {}) as Record<string, unknown>;
  if (!r.ok) {
    const zoho = (body.zoho || {}) as {
      attempted?: number;
      ok?: boolean;
      error?: string | null;
      rate_limited?: boolean;
      results?: ZohoResultRow[];
    };
    const errParts: string[] = [];
    if (typeof body.error === 'string' && body.error.trim()) errParts.push(body.error.trim());
    if (typeof zoho.error === 'string' && zoho.error.trim()) errParts.push(zoho.error.trim());
    for (const row of zoho.results ?? []) {
      if (typeof row.error === 'string' && row.error.trim()) {
        errParts.push(row.error.trim());
        break;
      }
    }
    const detail =
      errParts.length > 0
        ? [...new Set(errParts)].join(' · ')
        : 'Request did not complete successfully. Expand Raw response below for details.';
    const http2xx = r.httpStatus >= 200 && r.httpStatus < 300;
    if (http2xx && zoho.rate_limited) {
      return {
        verdict: 'rate_limit',
        headline: 'Zoho daily API quota exhausted',
        tone: 'rose',
        detail,
      };
    }
    if (http2xx && Number(zoho.attempted ?? 0) > 0 && zoho.ok === false) {
      return {
        verdict: 'api_error',
        headline: 'Zoho rejected the purchase receive',
        tone: 'rose',
        detail,
      };
    }
    if (http2xx) {
      return {
        verdict: 'http_error',
        headline: 'Receive failed',
        tone: 'rose',
        detail,
      };
    }
    return {
      verdict: 'http_error',
      headline: `Server error · HTTP ${r.httpStatus}`,
      tone: 'rose',
      detail,
    };
  }
  const zoho = (body.zoho || {}) as {
    attempted?: number;
    ok?: boolean;
    rate_limited?: boolean;
    error?: string | null;
    skip_reason?: string | null;
    results?: ZohoResultRow[];
    circuit?: { isOpen?: boolean; retryAfterMs?: number; consecutiveFailures?: number };
  };
  if (zoho.skip_reason === 'zoho_circuit_open') {
    // Cooldown is recoverable, not a hard failure: the lines committed locally
    // and the background sync replays once Zoho's breaker closes. Amber, with a
    // concrete retry window (surfaced from the server's in-process breaker —
    // this is what replaced the former 3s client-side /api/zoho/health check).
    const secs = Math.max(1, Math.ceil((zoho.circuit?.retryAfterMs ?? 0) / 1000));
    return {
      verdict: 'circuit_open',
      headline: `Zoho cooldown — retry in ~${secs}s`,
      tone: 'amber',
      detail: `Circuit breaker open after ${zoho.circuit?.consecutiveFailures ?? 0} recent Zoho failures. Lines saved locally and stay in Scanned; the PO syncs once Zoho recovers.`,
    };
  }
  if (zoho.skip_reason === 'zoho_already_fully_received') {
    return {
      verdict: 'success',
      headline: 'Success — PO has been marked as received',
      tone: 'emerald',
      detail: '',
    };
  }
  if (zoho.skip_reason === 'no_receiving_lines') {
    return {
      verdict: 'skipped',
      headline: 'No lines on this shipment',
      tone: 'amber',
      detail: 'There are no receiving_lines rows for this package yet.',
    };
  }
  if (zoho.skip_reason === 'no_zoho_link') {
    return {
      verdict: 'skipped',
      headline: 'Zoho NOT updated — no PO link',
      tone: 'amber',
      detail:
        'No Zoho purchaseorder_id / line_item_id is attached to this package. Click the refresh icon to sync with Zoho first, then try again.',
    };
  }
  if (zoho.skip_reason === 'scan_only') {
    return {
      verdict: 'success',
      headline: 'Success — line marked as scanned',
      tone: 'emerald',
      detail: '',
    };
  }
  if (!zoho.attempted) {
    return {
      verdict: 'skipped',
      headline: 'Zoho NOT updated — no PO link',
      tone: 'amber',
      detail:
        'Lines were saved locally but no Zoho purchaseorder_id / line_item_id is attached to this package. Click the refresh icon to sync with Zoho first, then try again.',
    };
  }
  if (zoho.rate_limited) {
    return {
      verdict: 'rate_limit',
      headline: 'Zoho daily API quota exhausted',
      tone: 'rose',
      detail:
        'Local DB updated, but Zoho purchase receive was rejected with rate-limit. Wait for the daily reset or pause other Zoho-touching workflows.',
    };
  }
  const firstErrorKind = zoho.results?.find((x) => x.error_kind)?.error_kind ?? null;
  if (!zoho.ok && firstErrorKind === 'circuit_open') {
    return {
      verdict: 'circuit_open',
      headline: 'Zoho circuit breaker tripped',
      tone: 'rose',
      detail:
        zoho.error ||
        'Recent Zoho failures caused the client to suppress new requests for a cooldown window. Retry in a minute.',
    };
  }
  if (!zoho.ok) {
    return {
      verdict: 'api_error',
      headline: 'Zoho API rejected the receive',
      tone: 'rose',
      detail: zoho.error || 'Zoho returned an error — see the raw response below for the exact reason.',
    };
  }
  return {
    verdict: 'success',
    headline: 'Success — PO has been marked as received',
    tone: 'emerald',
    detail: '',
  };
}

export function ReceiveResponsePanel({
  response,
  expanded,
  onToggle,
  onDismiss,
}: ReceiveResponsePanelProps) {
  const body = (response.body || {}) as Record<string, unknown>;
  const classification = classifyReceiveResponse(response);
  const showApiErrorCallout =
    !response.ok &&
    typeof body.error === 'string' &&
    body.error.trim().length > 0;
  const toneStyles = {
    emerald: {
      bar: 'bg-emerald-500',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      title: 'text-emerald-900',
      dot: 'bg-emerald-500',
    },
    amber: {
      bar: 'bg-amber-500',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      title: 'text-amber-900',
      dot: 'bg-amber-500',
    },
    rose: {
      bar: 'bg-rose-500',
      bg: 'bg-rose-50',
      border: 'border-rose-200',
      title: 'text-rose-900',
      dot: 'bg-rose-500',
    },
  }[classification.tone];

  const zoho = (body.zoho || {}) as {
    attempted?: number;
    ok?: boolean;
    rate_limited?: boolean;
    error?: string | null;
    skip_reason?: string | null;
    results?: ZohoResultRow[];
  };
  const results = zoho.results ?? [];
  const timestamp = new Date(response.at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return (
    <div className={`-mx-2 mt-1.5 border-t ${toneStyles.border} px-2 pt-1.5 pb-2`}>
      <div className={`relative overflow-hidden rounded-md border ${toneStyles.border} ${toneStyles.bg}`}>
        <span className={`absolute inset-y-0 left-0 w-[3px] ${toneStyles.bar}`} aria-hidden />
        <div className="flex items-start gap-2 px-2 py-1.5">
          <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${toneStyles.dot}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className={`text-micro font-black uppercase tracking-wider ${toneStyles.title}`}>
                {classification.headline}
              </p>
              {classification.verdict !== 'success' ? (
                <span className="text-eyebrow font-semibold tabular-nums text-slate-500">
                  {timestamp} · {response.durationMs}ms · HTTP {response.httpStatus || '—'}
                </span>
              ) : null}
            </div>
            {classification.detail ? (
              <p className="mt-0.5 text-micro font-medium leading-snug text-slate-700">
                {classification.detail}
              </p>
            ) : null}
            {showApiErrorCallout ? (
              <div className="mt-1.5 rounded border border-rose-200 bg-rose-50/90 px-1.5 py-1">
                <p className="text-mini font-black uppercase tracking-wide text-rose-800">API response</p>
                <p className="break-words font-mono text-micro leading-snug text-rose-950">
                  {String(body.error)}
                </p>
              </div>
            ) : null}
            {results.length > 0 && classification.verdict !== 'success' ? (
              <ul className="mt-1.5 space-y-0.5">
                {results.map((r, i) => {
                  const ok = !r.error;
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-1.5 text-micro leading-tight"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        aria-hidden
                      />
                      <span className="truncate font-mono font-semibold text-slate-800">
                        PO {r.purchaseorder_id ?? '?'}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="truncate text-slate-600">
                        {ok
                          ? `receive ${r.receive_id ?? '—'}`
                          : `${r.error_kind ?? 'error'}: ${r.error ?? 'unknown'}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? 'Hide raw response' : 'Show raw response'}
              title={expanded ? 'Hide raw response' : 'Show raw response'}
              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss response"
              title="Dismiss"
              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
        {expanded ? (
          <div className={`border-t ${toneStyles.border} bg-white/70 px-2 py-1.5`}>
            <p className="mb-1 text-mini font-black uppercase tracking-widest text-slate-500">
              Raw response · /api/receiving/mark-received-po
            </p>
            <pre className="max-h-56 overflow-auto rounded border border-slate-200 bg-white p-1.5 font-mono text-eyebrow leading-relaxed text-slate-700">
{JSON.stringify(response.body ?? { networkError: response.networkError }, null, 2)}
            </pre>
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(
                      JSON.stringify(response.body ?? { networkError: response.networkError }, null, 2),
                    );
                    toast.success('Response copied');
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50"
              >
                Copy JSON
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
