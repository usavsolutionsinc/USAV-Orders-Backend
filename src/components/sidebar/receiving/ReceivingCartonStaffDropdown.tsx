'use client';

import { useEffect, useState } from 'react';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { formatDatePST, formatTime12hPST } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type ReceivingCartonStaffApiRow = {
  received_by?: number | null;
  received_at?: string | null;
  unboxed_at?: string | null;
  unboxed_by?: number | null;
};

interface Props {
  receivingId: number | null;
  staffId: string;
  /** Opens the claim modal — surfaced as a row beneath the photo strip. */
  onMakeClaim?: () => void;
}

/**
 * Staff / received / unboxed timestamps. Flat display — no collapsible
 * chevron, no colored rail. Just the data, surfaced under the workspace
 * header as the operator's "where am I" anchor.
 *
 * Photo strip moved out: dedicated `PhotosCard` now owns photo display.
 */
export function ReceivingCartonStaffDropdown({ receivingId, staffId, onMakeClaim }: Props) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message?: string }
    | { status: 'ok'; carton: ReceivingCartonStaffApiRow }
  >({ status: 'idle' });

  useEffect(() => {
    if (receivingId == null) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch(`/api/receiving/${receivingId}`);
        const data = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          receiving?: ReceivingCartonStaffApiRow;
        } | null;
        if (cancelled) return;
        const carton = data?.receiving;
        if (!data?.success || !carton) {
          const msg =
            typeof data?.error === 'string'
              ? data.error
              : !res.ok
                ? `HTTP ${res.status}`
                : undefined;
          setState({ status: 'error', message: msg });
          return;
        }
        setState({ status: 'ok', carton });
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Network error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receivingId]);

  if (receivingId == null) return null;

  return (
    <div className="bg-white px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
            Staff · Scanned · Received
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            RCV-{receivingId}
          </span>
        </div>
        {onMakeClaim ? (
          <button
            type="button"
            onClick={onMakeClaim}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-orange-500 px-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-orange-600"
            title="File a damage / wrong-item / missing claim for this carton"
          >
            Claim →
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
          {state.status === 'loading' ? (
            <div
              className="space-y-2.5"
              aria-busy="true"
              aria-label="Loading receiving details"
              role="status"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="h-[13px] w-[min(8rem,55%)] max-w-[55%] animate-pulse rounded-sm bg-slate-200/90" />
                <div className="h-[13px] w-[6.5rem] shrink-0 animate-pulse rounded-sm bg-slate-200/90" />
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="h-[13px] w-[4.75rem] shrink-0 animate-pulse rounded-sm bg-slate-200/90" />
                <div className="h-[13px] w-[6.5rem] shrink-0 animate-pulse rounded-sm bg-slate-200/90" />
              </div>
            </div>
          ) : state.status === 'error' ? (
            <p className="text-[11px] font-medium text-rose-600">
              {state.message
                ? `Could not load receiving details: ${state.message}`
                : 'Could not load receiving details.'}
            </p>
          ) : state.status === 'ok' ? (
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <div
                  className="flex min-w-0 flex-1 items-baseline gap-x-2 overflow-hidden whitespace-nowrap text-[11px] font-semibold"
                  title={
                    state.carton.received_by
                      ? `${getStaffName(state.carton.received_by)} SCANNED`
                      : undefined
                  }
                >
                  <span
                    className={`min-w-0 shrink truncate ${
                      state.carton.received_by
                        ? stationThemeColors[getStaffThemeById(state.carton.received_by)].text
                        : 'text-slate-900'
                    }`}
                  >
                    {state.carton.received_by
                      ? getStaffName(state.carton.received_by)
                      : '—'}
                  </span>
                  <span className="shrink-0 uppercase text-slate-600">Scanned</span>
                </div>
                <span className="shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-900">
                  {state.carton.received_at
                    ? `${formatDatePST(state.carton.received_at)} ${formatTime12hPST(state.carton.received_at)}`
                    : '—'}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-[11px] font-semibold uppercase text-slate-600">
                  Unboxed at
                </span>
                <span className="shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-900">
                  {state.carton.unboxed_at
                    ? `${formatDatePST(state.carton.unboxed_at)} ${formatTime12hPST(state.carton.unboxed_at)}`
                    : '—'}
                </span>
              </div>
            </div>
          ) : null}

        {/* Photos strip — claim CTA lives in the header corner above. */}
        <div className="border-t border-slate-100 pt-3">
          <ReceivingPhotoStrip
            receivingId={receivingId}
            staffId={Number(staffId) || 0}
          />
        </div>
      </div>
    </div>
  );
}
