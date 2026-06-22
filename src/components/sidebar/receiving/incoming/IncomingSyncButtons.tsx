import { RefreshCw, Truck, Mail } from '@/components/Icons';
import type { useIncomingSyncActions } from './useIncomingSyncActions';

/**
 * The three Incoming sync buttons — each refreshes a distinct upstream (Zoho
 * issued POs, carrier tracking, PO mailbox) and re-reads the tiles + rows, then
 * opens its own result dialog.
 */
export function IncomingSyncButtons({ sync }: { sync: ReturnType<typeof useIncomingSyncActions> }) {
  return (
    <div className="relative px-1.5">
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => void sync.refreshZoho()}
          disabled={sync.zohoRefreshing}
          title="Re-sync Zoho issued POs + mirror status. Received POs clear from Incoming."
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-caption font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sync.zohoRefreshing ? 'animate-spin' : ''}`} />
          {sync.zohoRefreshing ? 'Zoho…' : 'Zoho'}
        </button>
        <button
          type="button"
          onClick={() => void sync.refreshTracking()}
          disabled={sync.refreshing}
          title="Re-poll UPS / USPS / FedEx for the tracking numbers in the Incoming list, then refresh"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-caption font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Truck className={`h-3.5 w-3.5 ${sync.refreshing ? 'animate-pulse' : ''}`} />
          {sync.refreshing ? 'Tracking…' : 'Tracking'}
        </button>
        <button
          type="button"
          onClick={() => void sync.rescanEmail()}
          disabled={sync.rescanning}
          title="Rescan the PO mailbox for ORDER DELIVERED emails, then refresh"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-caption font-bold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Mail className={`h-3.5 w-3.5 ${sync.rescanning ? 'animate-pulse' : ''}`} />
          {sync.rescanning ? 'Email…' : 'Email'}
        </button>
      </div>
    </div>
  );
}
