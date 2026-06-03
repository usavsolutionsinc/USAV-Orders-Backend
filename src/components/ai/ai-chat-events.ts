'use client';

/**
 * Cross-tree bridge for /ai-chat. The live chat now lives in the main page
 * (right), while the capabilities + example prompts live in the contextual
 * sidebar (left). They render in separate React trees, so the sidebar talks to
 * the chat through these window events instead of shared hook state — same
 * pattern the older AiChatPanel used with its `ai-new-chat` event.
 */
export const AI_CHAT_PROMPT_EVENT = 'usav:ai-chat-prompt';
export const AI_CHAT_NEW_EVENT = 'usav:ai-chat-new';

/** Sidebar → page: send an example prompt into the chat. */
export function emitAiChatPrompt(prompt: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(AI_CHAT_PROMPT_EVENT, { detail: prompt }));
}

/** Sidebar → page: start a fresh conversation. */
export function emitAiChatNew(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_CHAT_NEW_EVENT));
}
