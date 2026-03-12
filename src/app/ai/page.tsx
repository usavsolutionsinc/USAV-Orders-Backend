import AiChatPanel from '@/components/ai/AiChatPanel';

export const metadata = {
  title: 'AI Assistant — USAV',
};

export default function AiPage() {
  return (
    <div className="flex-1 h-full overflow-hidden">
      <AiChatPanel />
    </div>
  );
}
