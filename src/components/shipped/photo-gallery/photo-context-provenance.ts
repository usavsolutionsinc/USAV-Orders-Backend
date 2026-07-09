import { claimsTicketLabel } from '@/lib/photos/display-names';
import type { PhotoMeta } from './photo-gallery-utils';

export type PhotoWorkflowKind = 'unboxing' | 'packing' | 'claims' | 'unknown';

export interface PhotoWorkflowDescriptor {
  kind: PhotoWorkflowKind;
  label: string;
  /** Tailwind classes for the workflow badge. */
  tone: string;
}

/**
 * Workflow type inferred from meta — independent of whether a PO / order /
 * ticket id was persisted on the row.
 */
export function describePhotoWorkflow(meta: PhotoMeta): PhotoWorkflowDescriptor {
  const scope = meta.sourceScope;
  const type = (meta.photoType ?? '').toUpperCase();
  const isClaim = meta.ticketId != null || scope === 'claims' || type.includes('CLAIM');
  const isPacking =
    scope === 'packing' || type.includes('PACK') || type.includes('PACKER');

  if (isClaim) {
    return { kind: 'claims', label: 'Zendesk claim', tone: 'bg-amber-500/15 text-amber-200 ring-amber-400/30' };
  }
  if (isPacking) {
    return { kind: 'packing', label: 'Packing', tone: 'bg-violet-500/15 text-violet-200 ring-violet-400/30' };
  }
  if (scope === 'unboxing' || type.includes('RECEIV') || type.includes('UNBOX')) {
    return { kind: 'unboxing', label: 'Unboxing', tone: 'bg-blue-500/15 text-blue-200 ring-blue-400/30' };
  }
  return { kind: 'unknown', label: 'Photo', tone: 'bg-glass/10 text-stage-soft ring-glass/20' };
}

export interface LinkedEntityDisplay {
  /** Bold headline when a PO / order / ticket is known. */
  primary: string | null;
  /** Secondary line (e.g. ticket # under the subject). */
  secondary: string | null;
  /** Headline when the workflow is known but the entity id is missing. */
  missingHeadline: string | null;
  /** One-line clarifier under `missingHeadline`. */
  missingDetail: string | null;
}

function entityRefLabel(workflow: PhotoWorkflowDescriptor, meta: PhotoMeta): string | null {
  if (workflow.kind === 'claims') {
    return meta.ticketId != null ? claimsTicketLabel(meta.ticketId) : null;
  }
  if (!meta.poRef?.trim()) return null;
  if (workflow.kind === 'packing') return `Order ${meta.poRef}`;
  if (workflow.kind === 'unboxing') return `PO ${meta.poRef}`;
  return meta.poRef;
}

function missingEntityCopy(workflow: PhotoWorkflowDescriptor): Pick<LinkedEntityDisplay, 'missingHeadline' | 'missingDetail'> {
  switch (workflow.kind) {
    case 'unboxing':
      return {
        missingHeadline: 'PO not recorded',
        missingDetail: 'Captured during receiving — no purchase order was saved with this photo.',
      };
    case 'packing':
      return {
        missingHeadline: 'Order not recorded',
        missingDetail: 'Captured during packing — no order reference was saved with this photo.',
      };
    case 'claims':
      return {
        missingHeadline: 'Ticket not linked',
        missingDetail: 'Tagged as a claim photo but no Zendesk ticket is attached.',
      };
    default:
      return {
        missingHeadline: 'Nothing linked',
        missingDetail: 'No PO, order, or ticket is attached to this photo.',
      };
  }
}

/** Entity the user can navigate back to (PO, order, or ticket). */
export function resolveLinkedEntityDisplay(
  workflow: PhotoWorkflowDescriptor,
  meta: PhotoMeta | undefined,
  ticketSubject: string | null | undefined,
): LinkedEntityDisplay {
  if (!meta) {
    const missing = missingEntityCopy(workflow);
    return { primary: null, secondary: null, ...missing };
  }

  const refLabel = entityRefLabel(workflow, meta);

  if (workflow.kind === 'claims') {
    const primary = ticketSubject?.trim() || refLabel || null;
    const secondary = ticketSubject?.trim() && refLabel ? refLabel : null;
    if (primary) {
      return { primary, secondary, missingHeadline: null, missingDetail: null };
    }
    return { primary: null, secondary: null, ...missingEntityCopy(workflow) };
  }

  if (refLabel) {
    return { primary: refLabel, secondary: null, missingHeadline: null, missingDetail: null };
  }

  return { primary: null, secondary: null, ...missingEntityCopy(workflow) };
}

export interface ProvenanceNavLink {
  href: string;
  label: string;
}

/**
 * Deep link back into the photo library — entity-scoped when possible, otherwise
 * workflow-scoped so partially-linked photos still offer a useful exit.
 */
export function resolveProvenanceNavLink(
  workflow: PhotoWorkflowDescriptor,
  meta: PhotoMeta | undefined,
): ProvenanceNavLink | null {
  if (!meta) return null;

  if (workflow.kind === 'claims' && meta.ticketId != null) {
    return {
      href: `/ops/photos?sourceScope=claims&entityType=ZENDESK_TICKET&entityId=${meta.ticketId}`,
      label: 'View all claim photos',
    };
  }

  const poRef = meta.poRef?.trim();
  if (poRef) {
    const scope = workflow.kind === 'packing' ? 'packing' : workflow.kind === 'unboxing' ? 'unboxing' : 'all';
    const label =
      workflow.kind === 'packing'
        ? `View all from order ${poRef}`
        : workflow.kind === 'unboxing'
          ? `View all from PO ${poRef}`
          : `View all from ${poRef}`;
    return {
      href: `/ops/photos?sourceScope=${scope}&poRef=${encodeURIComponent(poRef)}`,
      label,
    };
  }

  switch (workflow.kind) {
    case 'unboxing':
      return { href: '/ops/photos?sourceScope=unboxing', label: 'Browse unboxing photos' };
    case 'packing':
      return { href: '/ops/photos?sourceScope=packing', label: 'Browse packing photos' };
    case 'claims':
      return { href: '/ops/photos?sourceScope=claims', label: 'Browse claim photos' };
    default:
      return null;
  }
}
