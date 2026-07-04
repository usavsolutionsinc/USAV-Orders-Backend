'use client';

/**
 * AI-edits tray (universal-feed plan §-2.1) — the live list of the draft's
 * agent_mutations (applied / proposed / reverted), each with a revert
 * affordance. Realtime via the org assist channel ('assistant.mutation');
 * scoped to the active Studio draft when one is loaded.
 *
 * Read/degrade-not-fail: a failed fetch shows nothing (the dock's primary job
 * is chat). House style throughout.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStudioWorkspace } from '@/components/studio/StudioWorkspaceContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { safeChannelName, getAiAssistChannelName } from '@/lib/realtime/channels';
import { Loader2, RotateCcw } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

interface MutationRow {
  id: number;
  mutation_kind: string;
  status: 'proposed' | 'applied' | 'reverted' | 'rejected' | 'under_review' | 'approved';
  applied_at: string | null;
  created_at: string;
}

const STATUS_CHIP: Record<string, string> = {
  applied: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  proposed: 'bg-amber-50 text-amber-700 ring-amber-200',
  under_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  reverted: 'bg-surface-canvas text-text-soft ring-border-soft',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  approved: 'bg-blue-50 text-blue-700 ring-blue-200',
};

export function AssistantEditsTray() {
  const { user, has } = useAuth();
  const studio = useStudioWorkspace();
  const [rows, setRows] = useState<MutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<number | null>(null);
  const canManage = has('studio.manage');
  const definitionId = studio.active && studio.isDraft ? studio.v : null;

  const load = useCallback(async () => {
    try {
      const qs = definitionId ? `?definitionId=${definitionId}&limit=15` : '?limit=15';
      const res = await fetch(`/api/assistant/mutations${qs}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { success: boolean; mutations: MutationRow[] };
      if (data.success) setRows(data.mutations);
    } catch {
      /* degrade to empty */
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Repaint on any apply/revert for this org.
  const channel = safeChannelName(() => getAiAssistChannelName(user?.organizationId ?? ''));
  useAblyChannel(channel, 'assistant.mutation', () => void load(), !!channel);

  const revert = useCallback(
    async (id: number) => {
      setReverting(id);
      try {
        const res = await fetch(`/api/assistant/mutations/${id}/revert`, { method: 'POST' });
        if (res.ok) await load();
      } finally {
        setReverting(null);
      }
    },
    [load],
  );

  return (
    <div className="border-t border-border-hairline px-4 py-3">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
        AI edits{definitionId ? ' · this draft' : ''}
      </p>
      {loading ? (
        <p className="mt-2 flex items-center gap-1.5 text-micro text-text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-micro leading-5 text-text-faint">
          Changes the assistant applies will appear here for review and revert.
        </p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate text-caption font-semibold text-text-default">
                {m.mutation_kind.replaceAll('_', ' ')}
              </span>
              <span
                className={cn(
                  'rounded-full px-1.5 text-mini font-black uppercase tracking-widest ring-1 ring-inset',
                  STATUS_CHIP[m.status] ?? 'bg-surface-canvas text-text-soft ring-border-soft',
                )}
              >
                {m.status}
              </span>
              {canManage && m.status === 'applied' ? (
                <HoverTooltip label="Revert" focusable={false}>
                  {/* ds-raw-button: tiny inline revert affordance, not a DS Button */}
                  <button
                    type="button"
                    aria-label={`Revert ${m.mutation_kind}`}
                    onClick={() => void revert(m.id)}
                    disabled={reverting === m.id}
                    className="flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-sunken hover:text-text-muted disabled:opacity-50"
                  >
                    {reverting === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                  </button>
                </HoverTooltip>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
