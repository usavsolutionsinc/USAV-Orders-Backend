'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from '@/components/Icons';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { formatDatePST, formatTime12hPST } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import {
  FLOW_SECTION_BTN_CLASS,
  FLOW_SECTION_TITLE_CLASS,
  FLOW_SECTION_SUMMARY_CLASS,
  RECEIVING_TRAIL_SLOT_CLASS,
} from './receiving-sidebar-shared';

type ReceivingCartonStaffApiRow = {
  received_by?: number | null;
  received_at?: string | null;
  unboxed_at?: string | null;
  unboxed_by?: number | null;
};

interface Props {
  receivingId: number | null;
  staffId: string;
}

/** Staff / received timestamps — black rail on the trigger only; expanded body is white. */
export function ReceivingCartonStaffDropdown({ receivingId, staffId }: Props) {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message?: string }
    | { status: 'ok'; carton: ReceivingCartonStaffApiRow }
  >({ status: 'idle' });

  useEffect(() => {
    if (receivingId != null) setOpen(true);
  }, [receivingId]);

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
    <div className="bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${FLOW_SECTION_BTN_CLASS} relative bg-zinc-50 hover:bg-zinc-100/70`}
      >
        <span className="absolute inset-y-0 left-0 w-[3px] bg-black" aria-hidden />
        <span className={`${FLOW_SECTION_TITLE_CLASS} text-zinc-900`}>Staff Scanned & Received</span>
        <span className="min-w-0 flex-1 text-right">
          <span className={FLOW_SECTION_SUMMARY_CLASS}>RCV-{receivingId}</span>
        </span>
        <span className={RECEIVING_TRAIL_SLOT_CLASS}>
          <ChevronDown
            className={`h-[14px] w-[14px] shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="border-b border-slate-200 bg-white px-2 py-2.5 space-y-3">
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
          <div className="border-t border-slate-100 pt-3">
            <ReceivingPhotoStrip
              receivingId={receivingId}
              staffId={Number(staffId) || 0}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
