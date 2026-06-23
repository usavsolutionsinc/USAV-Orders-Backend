import type { ContactFieldKey } from './CustomerInfoForm';
import type { RepairIntakeStepKey } from './RepairIntakeStepper';
import type { RepairFormData } from './RepairIntakeForm';

/** Per-step header copy for the intake wizard. */
export const REPAIR_STEP_COPY: Record<RepairIntakeStepKey, { title: string; subtitle: string }> = {
  product: {
    title: 'Select repair service',
    subtitle: 'Choose the product or pick a common repair.',
  },
  issue: {
    title: 'Issue / reason for repair',
    subtitle: 'Describe what needs to be repaired.',
  },
  contact: {
    title: 'Contact information',
    subtitle: 'Enter customer details for the repair ticket.',
  },
  review: {
    title: 'Review & sign',
    subtitle: 'Confirm all details with the customer before submitting.',
  },
};

/** Whether a single contact-step field is satisfied. Serial + price are required
 *  in the combined "extras" step; email is optional, notes ride along with extras. */
export function isContactFieldValid(field: ContactFieldKey, data: RepairFormData): boolean {
  switch (field) {
    case 'name':
      return !!data.customer.name.trim();
    case 'phone':
      return !!data.customer.phone.trim();
    case 'email':
      return true;
    case 'extras':
      return !!data.serialNumber.trim() && !!data.price.trim();
  }
}

/** Seed the form state from optional initial data (price defaults to 130). */
export function buildInitialFormData(initialData?: Partial<RepairFormData>): RepairFormData {
  return {
    product: {
      type: initialData?.product?.type || '',
      model: initialData?.product?.model || '',
      sourceSku: initialData?.product?.sourceSku ?? null,
    },
    repairReasons: Array.isArray(initialData?.repairReasons) ? initialData!.repairReasons : [],
    repairNotes: initialData?.repairNotes || '',
    customer: {
      name: initialData?.customer?.name || '',
      phone: initialData?.customer?.phone || '',
      email: initialData?.customer?.email || '',
    },
    serialNumber: initialData?.serialNumber || '',
    price: initialData?.price || '130',
    notes: initialData?.notes || '',
    assignedTechId: initialData?.assignedTechId ?? null,
    assignedTechName: initialData?.assignedTechName || '',
    signatureDataUrl: null,
    signatureStrokes: null,
  };
}

/** Format a 10-digit phone as `xxx-xxx-xxxx`; pass through anything else. */
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}
