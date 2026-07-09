'use client';

/**
 * Operations → Insights mode. Docks the existing streaming AI assistant in the
 * right pane and wires it to the Operations sidebar's prompt chips via the
 * shared `ai-chat-events` window events (same protocol AiChatWorkspace uses).
 *
 * The server-side chat already enriches each turn with live ops/inventory
 * context (intent-router + context-fetchers), so we reuse `useAiChat` +
 * `AiChatConversation` as-is — no client-side context plumbing required.
 */

import { useEffect } from 'react';
import { useAiChat } from '@/components/ai/useAiChat';
import AiChatConversation from '@/components/ai/AiChatConversation';
import { AI_CHAT_NEW_EVENT, AI_CHAT_PROMPT_EVENT } from '@/components/ai/ai-chat-events';

export function OperationsInsightsView() {
  const chat = useAiChat();
  const { send, reset } = chat;

  useEffect(() => {
    const onPrompt = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.trim()) send(detail);
    };
    const onNew = () => reset();
    window.addEventListener(AI_CHAT_PROMPT_EVENT, onPrompt);
    window.addEventListener(AI_CHAT_NEW_EVENT, onNew);
    return () => {
      window.removeEventListener(AI_CHAT_PROMPT_EVENT, onPrompt);
      window.removeEventListener(AI_CHAT_NEW_EVENT, onNew);
    };
  }, [send, reset]);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full min-h-0 bg-surface-canvas">
      <AiChatConversation variant="full" chat={chat} />
    </div>
  );
}
