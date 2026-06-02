'use client';

import { useAuth } from '@/contexts/AuthContext';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { RefreshCw } from '@/components/Icons';
import { useAiChat } from '@/components/ai/useAiChat';
import AiChatConversation from '@/components/ai/AiChatConversation';

/**
 * Contextual sidebar for /ai-chat: a full streaming AI chat docked in the
 * standard sidebar system. Same render path as the full-page view — both use
 * the `useAiChat` hook + `AiChatConversation` surface — so behavior is identical.
 */
export function AiChatSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const chat = useAiChat();

  if (isLoaded && !has('dashboard.view')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “View dashboard” permission.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2.5">
        <p className={`${sectionLabel} text-blue-600`}>AI Chat</p>
        <button
          type="button"
          onClick={() => chat.reset()}
          aria-label="New chat"
          title="New chat"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AiChatConversation variant="panel" chat={chat} />
      </div>
    </div>
  );
}
