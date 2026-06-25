'use client';

/**
 * Data layer for the native Zendesk console (/support). Thin TanStack Query
 * wrappers over the existing /api/zendesk/* routes. The optimistic mutation
 * shape mirrors useUpdateRepairStatus in src/hooks/useRepairQueries.ts.
 *
 * Types are imported `import type` from src/lib/zendesk.ts so none of that
 * module's server-only code is bundled into the client.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import type {
  ZendeskTicket,
  ZendeskComment,
  ZendeskAgent,
  ZendeskUser,
} from '@/lib/zendesk';

export type StatusFilter =
  | 'open' // active working set: status < solved
  | 'new'
  | 'pending'
  | 'hold'
  | 'solved'
  | 'closed'
  | 'all';

export interface TicketListParams {
  query: string;
  status: StatusFilter;
  page: number;
  perPage?: number;
  /** Applied in list mode (no free-text search); ignored by Zendesk search. */
  sortBy?: 'created_at' | 'updated_at' | 'priority' | 'status' | 'id';
  sortOrder?: 'asc' | 'desc';
}

export interface TicketListResult {
  mode: 'list' | 'search';
  subdomain: string;
  tickets: ZendeskTicket[];
  count: number;
  next_page: string | null;
  previous_page: string | null;
}

/** Patch shape accepted by PATCH /api/zendesk/tickets/[id] for the editors we expose. */
export interface TicketPatch {
  status?: ZendeskTicket['status'];
  priority?: ZendeskTicket['priority'];
  assignee_id?: number | null;
  subject?: string;
  tags?: string[];
}

export const zendeskKeys = {
  tickets: (p: TicketListParams) => ['zendesk', 'tickets', p] as const,
  ticket: (id: number) => ['zendesk', 'ticket', id] as const,
  comments: (id: number) => ['zendesk', 'ticket', id, 'comments'] as const,
  photos: (id: number) => ['zendesk', 'ticket', id, 'photos'] as const,
  assignment: (id: number) => ['zendesk', 'ticket', id, 'assignment'] as const,
  agents: () => ['zendesk', 'agents'] as const,
  users: (ids: number[]) => ['zendesk', 'users', [...ids].sort((a, b) => a - b)] as const,
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/** True when the API reported Zendesk credentials are not configured (503). */
export function isNotConfigured(err: unknown): boolean {
  return err instanceof HttpError && err.status === 503;
}

async function getJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new HttpError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

function statusClause(s: StatusFilter): string | null {
  if (s === 'all') return null;
  if (s === 'open') return 'status<solved'; // new + open + pending + hold
  return `status:${s}`;
}

/**
 * Build the ZQL `query` param from the free-text box + status chip. Returns null
 * when neither is set → the route stays in plain list mode (newest first).
 */
export function buildTicketQuery(text: string, status: StatusFilter): string | null {
  const clauses: string[] = [];
  const sc = statusClause(status);
  if (sc) clauses.push(sc);
  const t = text.trim();
  if (t) clauses.push(t);
  return clauses.length ? clauses.join(' ') : null;
}

export function useZendeskTickets(params: TicketListParams) {
  const perPage = params.perPage ?? 25;
  return useQuery<TicketListResult, HttpError>({
    queryKey: zendeskKeys.tickets(params),
    queryFn: async () => {
      const sp = new URLSearchParams();
      const q = buildTicketQuery(params.query, params.status);
      if (q) sp.set('query', q);
      sp.set('page', String(Math.max(1, params.page)));
      sp.set('perPage', String(perPage));
      if (params.sortBy) sp.set('sortBy', params.sortBy);
      if (params.sortOrder) sp.set('sortOrder', params.sortOrder);
      return getJson<TicketListResult>(`/api/zendesk/tickets?${sp.toString()}`);
    },
    // Keep the previous page/search visible while the next loads (no blanking).
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: (count, err) => err.status !== 503 && count < 2,
  });
}

export function useZendeskTicket(id: number | null) {
  return useQuery<ZendeskTicket, HttpError>({
    queryKey: zendeskKeys.ticket(id ?? 0),
    queryFn: async () => {
      const data = await getJson<{ ticket: ZendeskTicket }>(`/api/zendesk/tickets/${id}`);
      return data.ticket;
    },
    enabled: !!id,
    retry: (count, err) => err.status !== 503 && count < 2,
  });
}

export interface CommentsResult {
  comments: ZendeskComment[];
  count: number;
  next_page: string | null;
}

export function useTicketComments(id: number | null) {
  return useQuery<CommentsResult, HttpError>({
    queryKey: zendeskKeys.comments(id ?? 0),
    queryFn: () => getJson<CommentsResult>(`/api/zendesk/tickets/${id}/comments`),
    enabled: !!id,
    retry: (count, err) => err.status !== 503 && count < 2,
  });
}

export interface TicketPhoto {
  id: number;
  url: string;
  caption?: string | null;
  [key: string]: unknown;
}

export function useTicketPhotos(id: number | null) {
  return useQuery<{ entity: unknown; photos: TicketPhoto[] }, HttpError>({
    queryKey: zendeskKeys.photos(id ?? 0),
    queryFn: () => getJson<{ entity: unknown; photos: TicketPhoto[] }>(`/api/zendesk/tickets/${id}/photos`),
    enabled: !!id,
    retry: false,
  });
}

export function useZendeskAgents() {
  return useQuery<ZendeskAgent[], HttpError>({
    queryKey: zendeskKeys.agents(),
    queryFn: async () => {
      const data = await getJson<{ agents: ZendeskAgent[] }>(`/api/zendesk/agents`);
      return data.agents;
    },
    staleTime: 5 * 60_000,
    retry: (count, err) => err.status !== 503 && count < 1,
  });
}

/**
 * Resolve a set of Zendesk user ids to name/email — used to label comment authors
 * that aren't agents (the requester / end users) so the thread never shows a bare
 * "User #<id>". Keyed on the sorted id set so distinct comment threads dedupe.
 */
export function useZendeskUsers(ids: number[]) {
  const cleaned = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));
  return useQuery<ZendeskUser[], HttpError>({
    queryKey: zendeskKeys.users(cleaned),
    queryFn: async () => {
      const data = await getJson<{ users: ZendeskUser[] }>(
        `/api/zendesk/users?ids=${cleaned.join(',')}`,
      );
      return data.users;
    },
    enabled: cleaned.length > 0,
    staleTime: 5 * 60_000,
    retry: (count, err) => err.status !== 503 && count < 1,
  });
}

export interface TicketAssignment {
  ticketId: number;
  assignedStaffId: number;
  assignedStaffName: string;
  assignedBy: number | null;
  updatedAtMs: number;
}

/** The in-website staff owner of a ticket (separate from the Zendesk assignee). */
export function useTicketAssignment(id: number | null) {
  return useQuery<TicketAssignment | null, HttpError>({
    queryKey: zendeskKeys.assignment(id ?? 0),
    queryFn: async () => {
      const data = await getJson<{ assignment: TicketAssignment | null }>(
        `/api/zendesk/tickets/${id}/assign`,
      );
      return data.assignment;
    },
    enabled: !!id,
    retry: (count, err) => err.status !== 503 && count < 2,
  });
}

interface AssignVars {
  id: number;
  /** null clears the assignment. */
  staffId: number | null;
  /** Optional name for an optimistic label while the server confirms. */
  staffName?: string;
}

/** Assign a ticket to one of our staff (drops an inbox notification server-side). */
export function useAssignTicket() {
  const qc = useQueryClient();
  return useMutation<TicketAssignment | null, HttpError, AssignVars, { prev?: TicketAssignment | null }>({
    mutationFn: async ({ id, staffId }) => {
      const res = await fetch(`/api/zendesk/tickets/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new HttpError(res.status, data?.error || 'Assign failed');
      return (data.assignment ?? null) as TicketAssignment | null;
    },
    onMutate: async ({ id, staffId, staffName }) => {
      await qc.cancelQueries({ queryKey: zendeskKeys.assignment(id) });
      const prev = qc.getQueryData<TicketAssignment | null>(zendeskKeys.assignment(id));
      const next: TicketAssignment | null =
        staffId == null
          ? null
          : {
              ticketId: id,
              assignedStaffId: staffId,
              assignedStaffName: staffName ?? '…',
              assignedBy: null,
              updatedAtMs: 0,
            };
      qc.setQueryData<TicketAssignment | null>(zendeskKeys.assignment(id), () => next);
      return { prev };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx) qc.setQueryData(zendeskKeys.assignment(id), ctx.prev);
      toast.error('Could not update the staff assignment');
    },
    onSuccess: (_a, { staffId }) => {
      toast.success(staffId == null ? 'Assignment cleared' : 'Assigned to staff');
    },
    onSettled: (_a, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: zendeskKeys.assignment(id) });
    },
  });
}

interface UpdateVars {
  id: number;
  patch: TicketPatch;
}

/** Optimistically patch status/priority/assignee across the detail + list caches. */
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation<ZendeskTicket, HttpError, UpdateVars, { prevDetail?: ZendeskTicket; listSnaps: [readonly unknown[], unknown][] }>({
    mutationFn: async ({ id, patch }) => {
      const res = await fetch(`/api/zendesk/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new HttpError(res.status, data?.error || 'Update failed');
      return data.ticket as ZendeskTicket;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: zendeskKeys.ticket(id) });
      await qc.cancelQueries({ queryKey: ['zendesk', 'tickets'] });
      const prevDetail = qc.getQueryData<ZendeskTicket>(zendeskKeys.ticket(id));
      const listSnaps = qc.getQueriesData({ queryKey: ['zendesk', 'tickets'] });
      if (prevDetail) qc.setQueryData<ZendeskTicket>(zendeskKeys.ticket(id), { ...prevDetail, ...patch });
      qc.setQueriesData<TicketListResult>({ queryKey: ['zendesk', 'tickets'] }, (old) => {
        if (!old?.tickets) return old;
        return { ...old, tickets: old.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
      });
      return { prevDetail, listSnaps };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(zendeskKeys.ticket(id), ctx.prevDetail);
      ctx?.listSnaps?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error('Could not update the ticket');
    },
    onSuccess: () => {
      toast.success('Ticket updated');
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: zendeskKeys.ticket(id) });
      void qc.invalidateQueries({ queryKey: ['zendesk', 'tickets'] });
    },
  });
}

interface CommentVars {
  id: number;
  body: string;
  html_body?: string;
  isPublic: boolean;
}

/** Add a public reply or internal note. Not optimistic — the server assigns id/author/time. */
export function useAddComment() {
  const qc = useQueryClient();
  return useMutation<ZendeskTicket, HttpError, CommentVars>({
    mutationFn: async ({ id, body, html_body, isPublic }) => {
      const res = await fetch(`/api/zendesk/tickets/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, html_body, public: isPublic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new HttpError(res.status, data?.error || 'Failed to add comment');
      return data.ticket as ZendeskTicket;
    },
    onSuccess: (_t, { id, isPublic }) => {
      toast.success(isPublic ? 'Reply sent' : 'Internal note added');
      void qc.invalidateQueries({ queryKey: zendeskKeys.comments(id) });
      void qc.invalidateQueries({ queryKey: zendeskKeys.ticket(id) });
    },
    onError: () => toast.error('Could not add the comment'),
  });
}
