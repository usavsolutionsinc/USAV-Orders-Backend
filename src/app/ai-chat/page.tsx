import AiChatWorkspace from '@/components/ai/AiChatWorkspace';
import { PRODUCT_NAME } from '@/lib/branding/constants';

export const metadata = { title: `AI Chat · ${PRODUCT_NAME}` };

/**
 * /ai-chat workspace. The live streaming assistant is docked in this main pane
 * (right side); the capabilities and example prompts live in the contextual
 * sidebar (AiChatSidebarPanel). Light theme throughout.
 */
export default function AiChatPage() {
  return (
    <div className="h-full w-full overflow-hidden bg-surface-card">
      <AiChatWorkspace />
    </div>
  );
}
