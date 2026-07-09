'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/design-system/primitives';
import { Voicemail } from '@/components/Icons';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { parseSupportMode } from '@/components/sidebar/support/support-sidebar-shared';
import { VoicemailQueue } from '@/components/support/voice/VoicemailQueue';
import { VoicemailDetail } from '@/components/support/voice/VoicemailDetail';
import { CallLogView } from '@/components/support/voice/CallLogView';
import { SupportTicketDetail } from './chat/SupportTicketDetail';
import { SupportTicketQueue } from './queue/SupportTicketQueue';

/**
 * /support page body. The contextual sidebar (SupportSidebarPanel) owns the
 * per-mode picker/filter; this body shows the selected detail / stream and
 * reacts to the same `?mode=` URL param:
 *
 * - tickets   → selected Zendesk conversation (`?ticket=`).
 * - voicemail → selected voicemail detail (`?vm=`), Workbench crossfade.
 * - calls     → the org call-log Monitor stream (read-only).
 *
 * Below md the contextual sidebar isn't shown, so the mode's list falls back to
 * rendering here (full-screen list ⇄ detail swap).
 */
export function SupportWorkspace() {
  const { has, isLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseSupportMode(searchParams.get('mode'));
  const ticketId = Number(searchParams.get('ticket')) || null;
  const vmId = Number(searchParams.get('vm')) || null;

  const paneMotion = useMotionPresence(framerPresence.workbenchPane);
  const paneTransition = useMotionTransition(framerTransition.workbenchPaneMount);

  if (isLoaded && !has('integrations.zendesk')) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title="No access to Support"
          description="You need the “Manage Zendesk tickets” permission to view the support console."
        />
      </div>
    );
  }

  const clearParam = (key: 'ticket' | 'vm') => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete(key);
    const qs = sp.toString();
    router.push(qs ? `/support?${qs}` : '/support');
  };

  // ── Calls — Monitor (read-only stream; no durable selection) ───────────────
  if (mode === 'calls') {
    return (
      <div className="flex h-full min-h-0 w-full bg-surface-canvas">
        <CallLogView />
      </div>
    );
  }

  // ── Voicemail — Workbench (pick → detail; crossfade the pane) ──────────────
  if (mode === 'voicemail') {
    return (
      <div className="flex h-full min-h-0 w-full bg-surface-canvas">
        {/* Mobile/tablet (<md): no contextual sidebar, so the picker lives here. */}
        {!vmId ? (
          <div className="flex h-full w-full flex-col border-r border-border-soft bg-surface-card md:hidden">
            <VoicemailQueue />
          </div>
        ) : null}

        <div className={`${vmId ? 'flex' : 'hidden md:flex'} h-full min-h-0 w-full flex-col`}>
          <AnimatePresence mode="wait" initial={false}>
            {vmId != null ? (
              <motion.div
                key={`vm-${vmId}`}
                className="flex h-full min-h-0 w-full flex-col"
                initial={paneMotion.initial}
                animate={paneMotion.animate}
                exit={paneMotion.exit}
                transition={paneTransition}
              >
                <VoicemailDetail voicemailId={vmId} onBack={() => clearParam('vm')} />
              </motion.div>
            ) : (
              <motion.div
                key="vm-empty"
                className="flex h-full items-center justify-center"
                initial={paneMotion.initial}
                animate={paneMotion.animate}
                exit={paneMotion.exit}
                transition={paneTransition}
              >
                <EmptyState
                  icon={<Voicemail className="h-6 w-6 text-text-faint" />}
                  title="Select a voicemail"
                  description="Choose a follow-up from the list to play it and act on it."
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ── Tickets — Workbench (the existing Zendesk console; default) ────────────
  return (
    <div className="flex h-full min-h-0 w-full bg-surface-canvas">
      {/* Mobile/tablet (<md): no contextual sidebar, so the queue lives here. */}
      {!ticketId ? (
        <div className="flex h-full w-full flex-col border-r border-border-soft bg-surface-card md:hidden">
          <SupportTicketQueue />
        </div>
      ) : null}

      {/* Detail: full page on md+, full screen on mobile once a ticket is picked. */}
      <div className={`${ticketId ? 'flex' : 'hidden md:flex'} h-full min-h-0 w-full flex-col`}>
        {ticketId != null ? (
          <SupportTicketDetail ticketId={ticketId} onBack={() => clearParam('ticket')} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Select a ticket"
              description="Choose a ticket from the queue to view the conversation."
            />
          </div>
        )}
      </div>
    </div>
  );
}
