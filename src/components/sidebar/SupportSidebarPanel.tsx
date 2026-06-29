'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav/MasterNavContext';
import { SupportTicketQueue } from '@/components/support/zendesk/queue/SupportTicketQueue';
import { VoicemailQueue } from '@/components/support/voice/VoicemailQueue';
import { CallLogSidebar } from '@/components/support/voice/CallLogSidebar';
import { SupportModeToggle } from '@/components/sidebar/support/SupportModeToggle';
import type { SupportMode } from '@/components/sidebar/support/support-sidebar-shared';
import { useSupportMode } from '@/components/sidebar/support/useSupportMode';

/**
 * Contextual sidebar for /support. Three modes (the house sidebar-mode
 * contract, `?mode=` is the single source of truth):
 *
 * - tickets   → Zendesk ticket queue → conversation (Workbench; the default).
 * - voicemail → voicemail / missed-call follow-up to-do list (Workbench);
 *   selecting one sets `?vm=<id>` for the page body.
 * - calls     → org call log filter rail (Monitor); the stream lives in the body.
 *
 * The mode rail is suppressed when the master-nav drives mode switching
 * (`support` is in MASTER_NAV_RAIL_PAGES) — same gate Operations uses.
 */
export function SupportSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const queryClient = useQueryClient();
  const { mode, updateMode } = useSupportMode();
  const masterNavEnabled = useMasterNavEnabled();

  // Other surfaces still fire 'support-refresh' to invalidate the caches.
  useEffect(() => {
    const onRefresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['zendesk'] });
      void queryClient.invalidateQueries({ queryKey: ['voicemails'] });
      void queryClient.invalidateQueries({ queryKey: ['call-events'] });
    };
    window.addEventListener('support-refresh', onRefresh);
    return () => window.removeEventListener('support-refresh', onRefresh);
  }, [queryClient]);

  if (isLoaded && !has('integrations.zendesk')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “Manage Zendesk tickets” permission.
      </div>
    );
  }

  const modeToggle = masterNavEnabled ? null : (
    <SupportModeToggle value={mode} onChange={(id) => updateMode(id as SupportMode)} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {mode === 'voicemail' ? (
        <VoicemailQueue modeToggle={modeToggle} />
      ) : mode === 'calls' ? (
        <CallLogSidebar modeToggle={modeToggle} />
      ) : (
        <SupportTicketQueue modeToggle={modeToggle} />
      )}
    </div>
  );
}
