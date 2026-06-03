import AiChatWorkspace from '@/components/ai/AiChatWorkspace';

export const metadata = { title: 'AI Chat · USAV' };

/**
 * /ai-chat workspace. The live streaming assistant is docked in this main pane
 * (right side); the capabilities and example prompts live in the contextual
 * sidebar (AiChatSidebarPanel). Light theme throughout.
 */
export default function AiChatPage() {
  return (
    <div className="h-full w-full overflow-hidden bg-[#fbfbfa]">
      <AiChatWorkspace />
    </div>
  );
}
