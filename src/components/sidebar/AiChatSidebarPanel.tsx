'use client';

import { useAuth } from '@/contexts/AuthContext';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { Database, MessageSquare, PackageCheck, RefreshCw, Sparkles, Wrench } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { emitAiChatNew, emitAiChatPrompt } from '@/components/ai/ai-chat-events';
import { PRODUCT_NAME_AI } from '@/lib/branding/constants';

const CAPABILITIES = [
  { icon: PackageCheck, title: 'Orders & Shipping', detail: 'Shipped counts, tracking status, packer/tester attribution' },
  { icon: Database, title: 'Staff & FBA & Inventory', detail: 'Staff pace vs goals, FBA shipments, SKU stock levels' },
  { icon: Wrench, title: 'Repairs & Receiving', detail: 'Open tickets, parts-waiting, incoming POs, exceptions' },
  { icon: MessageSquare, title: 'Bose Service Manuals', detail: '480+ manuals — specs, procedures, parts, troubleshooting' },
];

const EXAMPLES = [
  'How many orders shipped last week and by who?',
  'Which open repairs are waiting for parts?',
  'What FBA shipments are currently open?',
  'How do I disassemble a Bose 251 speaker?',
];

/**
 * Contextual sidebar for /ai-chat: the capabilities overview and example
 * prompts. The live streaming assistant is docked in the main pane (right),
 * rendered by AiChatWorkspace. Selecting an example or "New chat" reaches the
 * chat through window events — see `ai-chat-events`.
 */
export function AiChatSidebarPanel() {
  const { has, isLoaded } = useAuth();

  if (isLoaded && !has('dashboard.view')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-text-soft">
        Requires the “View dashboard” permission.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      <div className={`flex shrink-0 items-center justify-between border-b border-border-hairline ${SIDEBAR_GUTTER} py-2.5`}>
        <p className={`${sectionLabel} text-blue-600`}>AI Chat</p>
        <HoverTooltip label="New chat" asChild>
          <IconButton
            onClick={() => emitAiChatNew()}
            ariaLabel="New chat"
            icon={<RefreshCw className="h-4 w-4" />}
            className="rounded-md p-1.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
          />
        </HoverTooltip>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-4`}>
        <div className="flex items-center gap-2 text-text-muted">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-inverse text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-base font-semibold tracking-tight text-text-default">{PRODUCT_NAME_AI}</p>
        </div>
        <p className="mt-2 text-caption leading-5 text-text-muted">
          Ask about the warehouse in plain English. The assistant streams its reply in the
          panel on the right and can query live data across orders, staff, FBA, inventory,
          repairs, and the Bose service manuals.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-border-soft bg-surface-card p-3">
              <div className="flex items-center gap-2 text-text-default">
                <c.icon className="h-4 w-4 text-blue-500" />
                <p className="text-caption font-semibold tracking-tight">{c.title}</p>
              </div>
              <p className="mt-1 text-micro leading-5 text-text-muted">{c.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <p className="text-micro font-black uppercase tracking-[0.2em] text-text-soft">Try asking</p>
          <div className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => emitAiChatPrompt(e)}
                className="ds-raw-button rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-left text-caption leading-5 text-text-muted transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-text-default"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
