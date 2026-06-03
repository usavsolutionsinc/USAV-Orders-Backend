'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAiChat } from '@/components/ai/useAiChat';
import AiChatConversation from '@/components/ai/AiChatConversation';
import { AI_CHAT_PROMPT_EVENT, AI_CHAT_NEW_EVENT } from '@/components/ai/ai-chat-events';

/**
 * Full-page chat surface for /ai-chat. The streaming assistant is docked here
 * (the main/right pane); the capabilities + example prompts live in the
 * contextual sidebar (AiChatSidebarPanel). Example clicks and "New chat" in the
 * sidebar reach this hook through window events — see `ai-chat-events`.
 */
export default function AiChatWorkspace() {
  const { has, isLoaded } = useAuth();
  const chat = useAiChat();
  const { send, reset } = chat;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
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

  if (isLoaded && !has('dashboard.view')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “View dashboard” permission.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <AiChatConversation variant="full" chat={chat} />
    </div>
  );
}
