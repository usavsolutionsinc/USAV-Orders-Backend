import type { RepairFormData } from '@/components/repair/RepairIntakeForm';
import { formatPhone } from '@/components/repair/repair-intake-logic';

export interface RepairReceiptProps {
  ticketNumber?: string | number;
  productTitle: string;
  issue: string;
  serialNumber: string;
  name: string;
  contact: string;
  price: string;
  startDateTime: string;
}

export function buildRepairIntakeReceiptProps(
  formData: RepairFormData,
  issueText: string,
  startDateTime: string,
  ticketNumber?: string | number,
): RepairReceiptProps {
  return {
    ticketNumber: ticketNumber ?? '',
    productTitle: formData.product.model || formData.product.type || '—',
    issue: issueText || '—',
    serialNumber: formData.serialNumber || '—',
    name: formData.customer.name || '—',
    contact: [
      formData.customer.phone ? formatPhone(formData.customer.phone) : '',
      formData.customer.email,
    ]
      .filter(Boolean)
      .join(', ') || '—',
    price: formData.price || '—',
    startDateTime,
  };
}
