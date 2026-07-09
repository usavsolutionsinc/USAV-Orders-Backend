/** Shared types for the reusable Zendesk claim modal (photo → ticket). */

export type ClaimMode = 'create' | 'update';

export type ClaimPriority = 'low' | 'normal' | 'high' | 'urgent';

/** A library photo pre-selected to attach. `src` is the thumbnail URL. */
export interface ClaimPhotoInput {
  id: number;
  src: string;
  /** Full-resolution URL when known (library browse). Falls back to `src`. */
  displayUrl?: string | null;
  poRef?: string | null;
  caption?: string | null;
}

/** A ticket chosen in "Update existing" mode. */
export interface PickedTicket {
  id: number;
  subject: string | null;
  status: string;
  priority: string | null;
}

export interface ClaimResult {
  ticketId: number;
  number: string; // "#123"
  url: string | null;
  mode: ClaimMode;
  attached: number;
}

export type ClaimWizardStep = 'pick' | 'compose';

export interface ZendeskClaimModalProps {
  open: boolean;
  onClose: () => void;
  /** Library photos pre-selected to attach. */
  photos: ClaimPhotoInput[];
  defaultMode?: ClaimMode;
  /** When launched from a ticket context, preselect update + this ticket. */
  defaultTicketId?: number | null;
  defaultTicketSubject?: string | null;
  /** Fired after a successful create/update (parent can refresh / clear selection). */
  onDone?: (result: ClaimResult) => void;
}

export const PRIORITY_OPTIONS: { value: ClaimPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];
