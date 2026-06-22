'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * useLocalAgents — honest, read-only status of the local/on-prem agents this
 * operation already runs, so the Operations page can "pair local agents to the
 * UI" by mapping each agent to the workflow stage it serves.
 *
 * These are REAL probes, not stubs:
 *   • Hermes (local LLM)    → GET /api/ai/health     — the on-prem agent that
 *                             powers PO-email triage, Zendesk claim drafts and
 *                             sourcing research. 503 when its tunnel is down.
 *   • Vision (RTX box)      → GET /api/vision-config  — the LAN visual-identify
 *                             service; an empty baseUrl = not configured.
 *   • Workflow engine       → GET /api/studio/live    — items currently moving
 *                             through the operations graph (the workflow the
 *                             agents map onto). Org-scoped on the server.
 *
 * Each probe is a single point-read on mount (no poll interval — the engine
 * read touches Neon and Studio law #4 forbids canvas polling); the caller
 * exposes a manual refresh. Probes that the viewer lacks permission for (e.g.
 * studio.view) resolve to `unknown`/`unavailable` rather than throwing, so the
 * row degrades gracefully instead of failing the page.
 */

export type AgentStatus = 'online' | 'offline' | 'unconfigured' | 'unknown';

export interface LocalAgentState {
  /** Stable id used as a React key + telemetry handle. */
  id: 'hermes' | 'vision' | 'engine';
  status: AgentStatus;
  /** Short human detail (model id, in-flight count, reason offline…). */
  detail: string;
}

async function probeHermes(): Promise<LocalAgentState> {
  try {
    const res = await fetch('/api/ai/health', { cache: 'no-store' });
    if (res.status === 403) return { id: 'hermes', status: 'unknown', detail: 'No access' };
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; model?: string; error?: string }
      | null;
    if (res.ok && data?.ok) {
      return { id: 'hermes', status: 'online', detail: data.model ?? 'hermes-agent' };
    }
    return { id: 'hermes', status: 'offline', detail: data?.error ?? 'Unreachable' };
  } catch {
    return { id: 'hermes', status: 'offline', detail: 'Unreachable' };
  }
}

async function probeVision(): Promise<LocalAgentState> {
  try {
    const res = await fetch('/api/vision-config', { cache: 'no-store' });
    if (res.status === 403) return { id: 'vision', status: 'unknown', detail: 'No access' };
    const data = (await res.json().catch(() => null)) as { baseUrl?: string } | null;
    const baseUrl = (data?.baseUrl ?? '').trim();
    return baseUrl
      ? { id: 'vision', status: 'online', detail: 'Identify box configured' }
      : { id: 'vision', status: 'unconfigured', detail: 'No box configured' };
  } catch {
    return { id: 'vision', status: 'unknown', detail: 'Unavailable' };
  }
}

async function probeEngine(): Promise<LocalAgentState> {
  try {
    const res = await fetch('/api/studio/live', { cache: 'no-store' });
    if (res.status === 403) return { id: 'engine', status: 'unknown', detail: 'No access' };
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; totalInFlight?: number }
      | null;
    if (res.ok && data?.ok) {
      const n = data.totalInFlight ?? 0;
      return {
        id: 'engine',
        status: n > 0 ? 'online' : 'unknown',
        detail: n > 0 ? `${n} in flight` : 'Idle · no active graph',
      };
    }
    return { id: 'engine', status: 'unknown', detail: 'No active graph' };
  } catch {
    return { id: 'engine', status: 'unknown', detail: 'Unavailable' };
  }
}

export interface LocalAgentsResult {
  agents: LocalAgentState[] | undefined;
  isLoading: boolean;
  refetch: () => void;
}

/** Probe all local agents once on mount; manual refresh only (no polling). */
export function useLocalAgents(): LocalAgentsResult {
  const { data, isLoading, refetch } = useQuery<LocalAgentState[]>({
    queryKey: ['operations-local-agents'],
    queryFn: () => Promise.all([probeHermes(), probeVision(), probeEngine()]),
    // Health is low-churn and the engine probe touches Neon — no refetchInterval
    // (Studio law #4). The row exposes a manual "Re-check" instead.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return { agents: data, isLoading, refetch: () => void refetch() };
}
