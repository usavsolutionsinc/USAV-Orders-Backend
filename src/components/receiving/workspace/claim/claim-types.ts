import type { LinearStepState } from '@/components/receiving/workspace/ReceivingProgressStepper';

/** 'create' files a fresh Zendesk ticket; 'link' attaches an existing one. */
export type ClaimModalMode = 'create' | 'link';

/**
 * Linear create-flow wizard. Each step owns exactly one job:
 *   photos  → pick claim type + acknowledge/select evidence photos
 *   compose → edit the full Zendesk subject + body
 *   review  → read-only all-in-one summary, then file + archive
 *   confirm → ticket-created + NAS-backup confirmation
 *   seller  → the seller-facing message
 * Link mode skips photos/compose/review/confirm and lands straight on `seller`.
 */
export type CreateClaimStep = 'photos' | 'compose' | 'review' | 'confirm' | 'seller';

/** The fixed left-to-right order of the create-flow steps. */
export const CREATE_STEP_ORDER: readonly CreateClaimStep[] = [
  'photos',
  'compose',
  'review',
  'confirm',
  'seller',
] as const;

/** The ticket that has been filed or linked for the current claim. */
export interface FiledTicket {
  number: string;
  url: string | null;
  id: number | null;
}

/** NAS backup result, displayed on the seller step (with a retry on failure). */
export interface ArchiveState {
  /** True when every photo archived cleanly (no warning / partial). */
  ok: boolean;
  copied: number;
  total: number;
  /** Folder the photos landed in (the ticket #), or null. */
  folder: string | null;
  /** Warning text when the backup failed or was partial. */
  warning: string | null;
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

/** The five create-flow steps, in order, for the linear header stepper. */
export const CLAIM_WIZARD_STEPS = [
  { key: 'photos', label: 'Photos' },
  { key: 'compose', label: 'Ticket' },
  { key: 'review', label: 'Review' },
  { key: 'confirm', label: 'Filed' },
  { key: 'seller', label: 'Seller' },
] as const;

export const SELLER_SKELETON_WIDTHS = ['92%', '88%', '76%', '84%', '68%', '56%'] as const;

/**
 * Derive the dot-stepper state for the linear create wizard. States are purely
 * positional: every step left of the current one is `done`, the current one is
 * `active`, the rest `pending`. (`filedTicket`/`mode` are accepted for symmetry
 * with the call site and future link-mode reuse.)
 */
export function claimWizardStepStates(
  createStep: CreateClaimStep,
  _filedTicket: FiledTicket | null,
  _mode: ClaimModalMode,
): Record<string, LinearStepState> {
  const curIdx = Math.max(0, CREATE_STEP_ORDER.indexOf(createStep));
  const states: Record<string, LinearStepState> = {};
  CREATE_STEP_ORDER.forEach((key, i) => {
    states[key] = i < curIdx ? 'done' : i === curIdx ? 'active' : 'pending';
  });
  return states;
}
