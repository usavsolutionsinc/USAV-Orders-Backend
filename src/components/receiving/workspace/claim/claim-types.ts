import type { LinearStepState } from '@/components/receiving/workspace/ReceivingProgressStepper';

/** 'create' files a fresh Zendesk ticket; 'link' attaches an existing one. */
export type ClaimModalMode = 'create' | 'link';

/** Two-step wizard within create/link flows. */
export type CreateClaimStep = 'internal' | 'seller';

/** The ticket that has been filed or linked for the current claim. */
export interface FiledTicket {
  number: string;
  url: string | null;
  id: number | null;
}

/** Slim ticket shape returned by GET /api/receiving/zendesk-claim/link. */
export interface LinkCandidate {
  id: number;
  subject: string | null;
  /** First-comment snippet for the expanded detail view (server-capped). */
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
  linkedToThis: boolean;
}

/** A carton photo eligible to attach to the Zendesk ticket. */
export interface ClaimPhoto {
  id: number;
  url: string;
}

export const CLAIM_WIZARD_STEPS = [
  { key: 'internal', label: 'Ticket Creation' },
  { key: 'seller', label: 'Seller Message' },
] as const;

export const SELLER_SKELETON_WIDTHS = ['92%', '88%', '76%', '84%', '68%', '56%'] as const;

/**
 * Derive the stepper state for the two-step claim wizard. The ticket step is
 * "done" once a ticket is filed (create) or whenever we are in link mode.
 */
export function claimWizardStepStates(
  createStep: CreateClaimStep,
  filedTicket: FiledTicket | null,
  mode: ClaimModalMode,
): Record<string, LinearStepState> {
  const ticketStepDone = !!filedTicket || mode === 'link';
  if (createStep === 'seller' && ticketStepDone) {
    return { internal: 'done', seller: 'active' };
  }
  if (ticketStepDone) {
    return { internal: 'done', seller: 'pending' };
  }
  return { internal: 'active', seller: 'pending' };
}
