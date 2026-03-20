import { SupportDashboard } from '@/components/support/SupportDashboard';

export default function SupportPage() {
  return (
    <div className="flex h-full w-full bg-gray-50">
      <div className="flex-1 min-w-0 overflow-hidden">
        <SupportDashboard />
      </div>
    </div>
  );
}
