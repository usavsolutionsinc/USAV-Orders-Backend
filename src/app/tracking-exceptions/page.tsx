import { TrackingExceptionsTable } from '@/components/tracking-exceptions/TrackingExceptionsTable';
import { PageHeader } from '@/components/ui/pane-header';

export const dynamic = 'force-dynamic';

export default function TrackingExceptionsPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <PageHeader title="Tracking Exceptions" />
      <p className="border-b border-gray-200 bg-white px-6 py-2 text-caption font-semibold text-gray-500">
        Receiving scans that did not resolve to a Zoho purchase order. Click refresh to re-query
        Zoho with the same tracking number; use the pencil to edit or delete.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <TrackingExceptionsTable />
      </div>
    </div>
  );
}
