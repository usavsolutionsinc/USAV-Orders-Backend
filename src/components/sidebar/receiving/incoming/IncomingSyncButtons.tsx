import { RefreshCw, Truck, Mail } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives/Button';
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
        <HoverTooltip
          label="Re-sync Zoho issued POs + mirror status. Received POs clear from Incoming."
          asChild
        >
          <button
            type="button"
            onClick={() => void sync.refreshZoho()}
            disabled={sync.zohoRefreshing}
            aria-label="Re-sync Zoho issued POs + mirror status. Received POs clear from Incoming."
            className="ds-raw-button flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-caption font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${sync.zohoRefreshing ? 'animate-spin' : ''}`} />
            {sync.zohoRefreshing ? 'Zoho…' : 'Zoho'}
          </button>
        </HoverTooltip>
        <HoverTooltip
          label="Re-poll UPS / USPS / FedEx for the tracking numbers in the Incoming list, then refresh"
          asChild
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void sync.refreshTracking()}
            disabled={sync.refreshing}
            ariaLabel="Re-poll UPS / USPS / FedEx for the tracking numbers in the Incoming list, then refresh"
            icon={<Truck className={sync.refreshing ? 'animate-pulse' : ''} />}
            className="flex-1 border border-blue-200 bg-blue-50 font-bold text-blue-700 hover:bg-blue-100"
          >
            {sync.refreshing ? 'Tracking…' : 'Tracking'}
          </Button>
        </HoverTooltip>
        <HoverTooltip
          label="Rescan the PO mailbox for ORDER DELIVERED emails, then refresh"
          asChild
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void sync.rescanEmail()}
            disabled={sync.rescanning}
            ariaLabel="Rescan the PO mailbox for ORDER DELIVERED emails, then refresh"
            icon={<Mail className={sync.rescanning ? 'animate-pulse' : ''} />}
            className="flex-1 border border-violet-200 bg-violet-50 font-bold text-violet-700 hover:bg-violet-100"
          >
            {sync.rescanning ? 'Email…' : 'Email'}
          </Button>
        </HoverTooltip>
      </div>
    </div>
  );
}
