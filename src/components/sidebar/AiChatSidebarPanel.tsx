'use client';

import { useAuth } from '@/contexts/AuthContext';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { Database, MessageSquare, PackageCheck, RefreshCw, Sparkles, Wrench } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { emitAiChatNew, emitAiChatPrompt } from '@/components/ai/ai-chat-events';

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
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “View dashboard” permission.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className={`flex shrink-0 items-center justify-between border-b border-gray-100 ${SIDEBAR_GUTTER} py-2.5`}>
        <p className={`${sectionLabel} text-blue-600`}>AI Chat</p>
        <button
          type="button"
          onClick={() => emitAiChatNew()}
          aria-label="New chat"
          title="New chat"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${SIDEBAR_GUTTER} py-4`}>
        <div className="flex items-center gap-2 text-gray-700">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-base font-semibold tracking-tight text-gray-900">USAV Assistant</p>
        </div>
        <p className="mt-2 text-caption leading-5 text-gray-600">
          Ask about the warehouse in plain English. The assistant streams its reply in the
          panel on the right and can query live data across orders, staff, FBA, inventory,
          repairs, and the Bose service manuals.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2 text-gray-900">
                <c.icon className="h-4 w-4 text-blue-500" />
                <p className="text-caption font-semibold tracking-tight">{c.title}</p>
              </div>
              <p className="mt-1 text-micro leading-5 text-gray-600">{c.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <p className="text-micro font-black uppercase tracking-[0.2em] text-gray-500">Try asking</p>
          <div className="mt-3 flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => emitAiChatPrompt(e)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-caption leading-5 text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-gray-900"
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
