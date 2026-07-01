import AiChatPanel from '@/components/ai/AiChatPanel';
import { PRODUCT_NAME } from '@/lib/branding/constants';

export const metadata = {
  title: `AI Chat — ${PRODUCT_NAME}`,
};

export default function AiPage() {
  return (
    <div className="flex-1 h-full overflow-hidden">
      <AiChatPanel />
    </div>
  );
}
