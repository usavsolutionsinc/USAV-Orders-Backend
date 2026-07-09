import { CONTACT_FIELDS, type ContactFieldKey } from './CustomerInfoForm';
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

export function isProductSelected(data: RepairFormData): boolean {
  return !!(data.product.type && data.product.model.trim());
}

export function hasRepairIssue(data: RepairFormData): boolean {
  return data.repairReasons.length > 0 || data.repairNotes.trim().length > 0;
}

export function isContactComplete(data: RepairFormData): boolean {
  return CONTACT_FIELDS.every((field) => isContactFieldValid(field, data));
}

/** Mirrors `/api/repair/submit` required fields + signature gate on the review step. */
export function canSubmitRepairIntake(data: RepairFormData, hasSignature: boolean): boolean {
  return isProductSelected(data) && hasRepairIssue(data) && isContactComplete(data) && hasSignature;
}

/** Tooltip copy when the review-step submit button is disabled. */
export function getRepairSubmitBlockReason(data: RepairFormData, hasSignature: boolean): string | undefined {
  if (!isProductSelected(data)) return 'Select a repair product to submit';
  if (!hasRepairIssue(data)) return 'Issue or repair notes required to submit';
  if (!data.customer.name.trim()) return 'Customer name required to submit';
  if (!data.customer.phone.trim()) return 'Phone number required to submit';
  if (!data.serialNumber.trim()) return 'Serial number required to submit';
  if (!data.price.trim()) return 'Price required to submit';
  if (!hasSignature) return 'Signature required to submit';
  return undefined;
}

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
