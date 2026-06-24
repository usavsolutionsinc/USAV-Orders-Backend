'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { Barcode, Check, Printer } from '../../Icons';
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
        <button
          type="button"
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
          className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm font-black uppercase tracking-wider transition-all hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
          title="Print 2x1 product label"
          aria-label="Print product label"
        >
          <Barcode className="w-4 h-4 text-gray-700" />
          Label
        </button>
        <button
          type="button"
          onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank', 'noopener,noreferrer')}
          className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm font-black uppercase tracking-wider transition-all hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
          title="Print repair service document"
          aria-label="Print repair service document"
        >
          <Printer className="w-4 h-4 text-gray-700" />
          Print
        </button>
      </div>
      <button
        type="button"
        onClick={() => c.setShowPickupFlow(true)}
        disabled={!c.canStartPickup}
        className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-black uppercase tracking-wider transition-all hover:bg-emerald-100 hover:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          c.canStartPickup
            ? 'Launch the customer pickup signature flow'
            : 'Available when the repair is ready for pickup'
        }
        aria-label="Start customer pickup signature"
      >
        <Check className="w-4 h-4" />
        Start Pickup
      </button>
    </section>
  );
}
