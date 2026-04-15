import { TrackingExceptionsTable } from '@/components/tracking-exceptions/TrackingExceptionsTable';

export const dynamic = 'force-dynamic';

export default function TrackingExceptionsPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-base font-black uppercase tracking-widest text-gray-900">
            Tracking Exceptions
          </h1>
          <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
            Receiving scans that did not resolve to a Zoho purchase order. Click refresh to re-query
            Zoho with the same tracking number; use the pencil to edit or delete.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <TrackingExceptionsTable />
      </div>
    </div>
  );
}
