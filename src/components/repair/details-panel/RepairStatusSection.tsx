'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { Barcode, Check, Printer } from '../../Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { printRepairLabel } from '@/lib/print/printRepairLabel';
import { STATUS_OPTIONS } from './repair-details-shared';
import type { RepairDetailsController } from './useRepairDetailsPanel';

/** Status select + Label/Print actions + Start-Pickup launcher. */
export function RepairStatusSection({ repair, c }: { repair: RSRecord; c: RepairDetailsController }) {
  return (
    <section>
      <select
        value={repair.status || ''}
        onChange={(e) => c.handleStatusChange(e.target.value)}
        disabled={c.updatingStatus}
        className={`w-full text-sm font-black uppercase tracking-wider px-4 py-3 rounded-lg border transition-all outline-none focus:ring-4 focus:ring-blue-500/10 ${
          repair.status === 'Done'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : repair.status?.includes('Awaiting')
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <option value="">Select Status...</option>
        {STATUS_OPTIONS.map(status => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <HoverTooltip label="Print 2x1 product label" asChild>
          <Button
            variant="secondary"
            size="lg"
            icon={<Barcode className="w-4 h-4 text-text-muted" />}
            onClick={() => {
              const fullName = (repair.contact_info || '').split(',')[0]?.trim() || '';
              const firstName = fullName.split(/\s+/)[0] || 'Repair';
              const fmtDate = (d: Date) =>
                d.toLocaleDateString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                  year: '2-digit',
                });
              const intake = repair.created_at ? new Date(repair.created_at) : new Date();
              const due = new Date(intake.getTime());
              // 10 calendar days — upper bound of the "3–10 working days" SLA on the receipt
              due.setDate(due.getDate() + 10);
              printRepairLabel({
                repairId: repair.id,
                rsCode: `RS-${repair.id}`,
                firstName,
                ticketNumber: repair.ticket_number || '',
                date: fmtDate(new Date()),
                dueDate: fmtDate(due),
              });
            }}
            ariaLabel="Print product label"
          >
            Label
          </Button>
        </HoverTooltip>
        <HoverTooltip label="Print repair service document" asChild>
          <Button
            variant="secondary"
            size="lg"
            icon={<Printer className="w-4 h-4 text-text-muted" />}
            onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank', 'noopener,noreferrer')}
            ariaLabel="Print repair service document"
          >
            Print
          </Button>
        </HoverTooltip>
      </div>
      <HoverTooltip
        label={
          c.canStartPickup
            ? 'Launch the customer pickup signature flow'
            : 'Available when the repair is ready for pickup'
        }
        asChild
      >
        <Button
          variant="secondary"
          size="lg"
          icon={<Check className="w-4 h-4" />}
          onClick={() => c.setShowPickupFlow(true)}
          disabled={!c.canStartPickup}
          ariaLabel="Start customer pickup signature"
          className="mt-2 w-full ring-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        >
          Start Pickup
        </Button>
      </HoverTooltip>
    </section>
  );
}
