import { SupportWorkspace } from '@/components/support/zendesk/SupportWorkspace';

export default function SupportPage() {
  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <div className="min-w-0 flex-1 overflow-hidden">
        <SupportWorkspace />
      </div>
    </div>
  );
}
