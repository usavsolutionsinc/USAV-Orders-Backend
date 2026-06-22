'use client';

import { useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { FileText } from '@/components/Icons';
import RepairServiceForm from './RepairServiceForm';
import type { RepairFormData } from './RepairIntakeForm';

/**
 * Persistent "paperwork" affordance for the repair intake flow.
 *
 * Acceptance B (P2-RPR-01): the document viewer must be reachable from ANY step.
 * This button lives in the RepairIntakeForm header (present on all four steps),
 * so a customer/tech can review the live repair-service agreement at any point
 * during entry — not only at the review step.
 *
 * Reuse-only: the viewer is the canonical responsive `BottomSheet` (centered
 * dialog on desktop, drag-to-dismiss sheet on mobile, portal + Escape-to-close)
 * and the same `RepairServiceForm` receipt the review step already renders. No
 * new viewer or modal primitive is introduced.
 */

interface RepairPaperworkSheetProps {
  formData: RepairFormData;
  /** Trailing slot styling alignment — header buttons are 36px square. */
  className?: string;
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export function RepairPaperworkSheet({ formData, className }: RepairPaperworkSheetProps) {
  const [open, setOpen] = useState(false);

  const issueText =
    [...formData.repairReasons, formData.repairNotes ? formData.repairNotes : null]
      .filter(Boolean)
      .join(', ') || '—';

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const receiptProps = {
    repairServiceId: '—',
    ticketNumber: '',
    productTitle: formData.product.model || formData.product.type || '—',
    issue: issueText,
    serialNumber: formData.serialNumber || '—',
    name: formData.customer.name || '—',
    contact: [
      formData.customer.phone ? formatPhone(formData.customer.phone) : '',
      formData.customer.email,
    ]
      .filter(Boolean)
      .join(', ') || '—',
    price: formData.price || '—',
    startDateTime: today,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-900 hover:text-gray-900'
        }
        aria-label="View repair paperwork"
        title="View repair paperwork"
      >
        <FileText className="h-4 w-4" />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Repair Paperwork" maxWidth="44rem">
        <div className="max-h-[70vh] overflow-y-auto">
          <p className="mb-3 px-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
            Live agreement preview — updates as you complete the intake
          </p>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <RepairServiceForm {...receiptProps} variant="preview" />
          </div>
          <div className="mt-4 space-y-1 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-center">
            <p className="text-[11px] leading-relaxed text-gray-600">
              By signing at the review step, the customer consents to conduct this transaction
              electronically and agrees to the listed repair price, terms, and any unexpected delays.
            </p>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-900">
              30-Day Warranty on all repair services
            </p>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
