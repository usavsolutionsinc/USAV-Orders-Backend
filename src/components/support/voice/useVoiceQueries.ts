'use client';

/**
 * React Query hooks for the voice support modes. These read the planned
 * endpoints (`/api/voicemails`, `/api/voicemails/[id]`, `/api/call-events`;
 * see docs/nextiva-voice-support-mode-plan.md). Until the Nextiva connector
 * ships, those routes 404/501 — the hooks surface that as `notConfigured` so
 * the UI shows a teaching "connect Nextiva" empty state instead of a red error
 * (degrade-not-fail, per the Workbench/Monitor archetype rules).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CallDirectionFilter,
  VoicemailStatusFilter,
} from '@/components/sidebar/support/support-sidebar-shared';
import type {
  CallEventItem,
  VoicemailDetailData,
  VoicemailListItem,
  VoicemailStatus,
} from './voice-presentation';

/** Thrown when the voice endpoints aren't wired yet (404/501). */
export const VOICE_NOT_CONFIGURED = 'VOICE_NOT_CONFIGURED' as const;

export function isNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message === VOICE_NOT_CONFIGURED;
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    // Network/abort — treat as not-yet-configured so the UI teaches, not screams.
    throw new Error(VOICE_NOT_CONFIGURED);
  }
  if (res.status === 404 || res.status === 501) throw new Error(VOICE_NOT_CONFIGURED);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface VoicemailListParams {
  status: VoicemailStatusFilter;
  query: string;
  assignee?: string | null;
}

interface VoicemailListResponse {
  items: VoicemailListItem[];
  openCount: number;
}

export function useVoicemails(params: VoicemailListParams): UseQueryResult<VoicemailListResponse> {
  const search = new URLSearchParams({ status: params.status });
  if (params.query) search.set('q', params.query);
  if (params.assignee) search.set('assignee', params.assignee);

  return useQuery<VoicemailListResponse>({
    queryKey: ['voicemails', params.status, params.query, params.assignee ?? null],
    queryFn: () => getJson<VoicemailListResponse>(`/api/voicemails?${search.toString()}`),
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useVoicemailDetail(id: number | null): UseQueryResult<VoicemailDetailData> {
  return useQuery<VoicemailDetailData>({
    queryKey: ['voicemails', 'detail', id],
    queryFn: () => getJson<VoicemailDetailData>(`/api/voicemails/${id}`),
    enabled: typeof id === 'number' && id > 0,
    staleTime: 30_000,
    retry: false,
  });
}

export interface CallEventsParams {
  direction: CallDirectionFilter;
  query: string;
}

interface CallEventsResponse {
  items: CallEventItem[];
}

export function useCallEvents(params: CallEventsParams): UseQueryResult<CallEventsResponse> {
  const search = new URLSearchParams();
  if (params.direction !== 'all') search.set('direction', params.direction);
  if (params.query) search.set('q', params.query);

  return useQuery<CallEventsResponse>({
    queryKey: ['call-events', params.direction, params.query],
    queryFn: () => getJson<CallEventsResponse>(`/api/call-events?${search.toString()}`),
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(VOICE_NOT_CONFIGURED);
  }
  if (res.status === 404 || res.status === 501) throw new Error(VOICE_NOT_CONFIGURED);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface FollowupUpdate {
  status?: VoicemailStatus;
  /** ISO timestamp to snooze until (status → 'snoozed'). */
  snoozeUntil?: string | null;
  assignedStaffId?: number | null;
  note?: string | null;
}

/** Update a voicemail follow-up (mark done / snooze / assign). Invalidates the list + detail. */
export function useUpdateFollowup(id: number | null): UseMutationResult<unknown, Error, FollowupUpdate> {
  const qc = useQueryClient();
  return useMutation<unknown, Error, FollowupUpdate>({
    mutationFn: (update) => patchJson(`/api/voicemails/${id}/followup`, update),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['voicemails'] });
    },
  });
}

/** Click-to-call: originate from the agent's extension to a number. */
export function useClickToCall(): UseMutationResult<unknown, Error, { to: string; voicemailId?: number }> {
  return useMutation<unknown, Error, { to: string; voicemailId?: number }>({
    mutationFn: async (vars) => {
      let res: Response;
      try {
        res = await fetch('/api/integrations/nextiva/call', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(vars),
        });
      } catch {
        throw new Error(VOICE_NOT_CONFIGURED);
      }
      if (res.status === 404 || res.status === 501) throw new Error(VOICE_NOT_CONFIGURED);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
  });
}
