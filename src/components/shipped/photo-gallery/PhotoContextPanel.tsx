'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle, Calendar, ChevronRight, ExternalLink, FileText, Image as ImageIcon,
  Layers, Package, Sparkles, User,
} from '../../Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { formatDateTimePST } from '@/utils/date';
import { useZendeskTicketSubject } from '@/hooks/useZendeskTicketSubject';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import {
  describePhotoWorkflow,
  resolveLinkedEntityDisplay,
  resolveProvenanceNavLink,
  type PhotoWorkflowKind,
} from './photo-context-provenance';
import type { PhotoItem } from './photo-gallery-utils';

/**
 * Right-side info panel for the fullscreen viewer — the "where did this photo
 * come from" surface. Workflow type (unboxing / packing / claim) is shown
 * separately from the linked entity (PO, order, ticket) so partially-attached
 * photos never read as contradictory.
 */

const WORKFLOW_ICONS = {
  unboxing: Package,
  packing: Layers,
  claims: FileText,
  unknown: ImageIcon,
} as const satisfies Record<PhotoWorkflowKind, typeof Package>;

function ProvenanceLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-micro font-black uppercase tracking-widest text-text-faint">{children}</p>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-micro font-black uppercase tracking-widest text-text-faint">
        <span className="text-text-soft">{icon}</span>
        {label}
      </p>
      <div className="text-sm text-stage-soft">{children}</div>
    </div>
  );
}

export function PhotoContextPanel({
  photo,
  onCollapse,
}: {
  photo: PhotoItem | undefined;
  onCollapse: () => void;
}) {
  const meta = photo?.meta;
  const panelPresence = useMotionPresence(framerPresence.photoContextPanel);
  const panelTransition = useMotionTransition(framerTransition.photoContextPanelMount);
  // Hook must run unconditionally; it self-disables for null/invalid ids.
  const ticketSubject = useZendeskTicketSubject(meta?.ticketId ?? null);

  if (!photo) return null;

  const workflow = meta ? describePhotoWorkflow(meta) : describePhotoWorkflow({});
  const linked = resolveLinkedEntityDisplay(workflow, meta, ticketSubject.data);
  const navLink = resolveProvenanceNavLink(workflow, meta);
  const WorkflowIcon = WORKFLOW_ICONS[workflow.kind];

  const analysisNode = meta?.damageDetected
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-200 ring-1 ring-inset ring-rose-400/30"><AlertTriangle className="h-3.5 w-3.5" /> Damage detected</span>
    : meta?.hasAnalysis
      ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/30"><Sparkles className="h-3.5 w-3.5" /> Analyzed · clear</span>
      : <span className="text-xs text-text-faint">Not analyzed yet</span>;

  return (
    <motion.aside
      data-testid="photo-context-panel"
      {...panelPresence}
      transition={panelTransition}
      aria-label="Photo details"
      className="relative z-20 flex h-full w-80 max-w-[85vw] shrink-0 flex-col gap-5 overflow-y-auto border-l border-glass/10 bg-scrim/60 px-5 pb-5 pt-6 backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-micro font-black uppercase tracking-widest text-text-faint">Details</p>
        <HoverTooltip label="Hide details (i)" asChild>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            className="rounded-full border border-glass/20 bg-glass/10 p-2 text-white transition-colors hover:bg-glass/20"
            ariaLabel="Hide photo details"
            icon={<ChevronRight className="h-4 w-4 text-white" />}
          />
        </HoverTooltip>
      </div>

      {/* Provenance — workflow type vs linked entity are separate fields. */}
      <section className="space-y-3" aria-labelledby="photo-provenance-type">
        <div className="space-y-1.5">
          <ProvenanceLabel>Type</ProvenanceLabel>
          <span
            id="photo-provenance-type"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wider ring-1 ring-inset ${workflow.tone}`}
          >
            <WorkflowIcon className="h-3.5 w-3.5" />
            {workflow.label}
          </span>
        </div>

        <div className="space-y-1.5">
          <ProvenanceLabel>Linked to</ProvenanceLabel>
          {linked.primary ? (
            <div className="space-y-0.5">
              <p data-testid="photo-context-ref" className="text-base font-bold leading-snug text-white">
                {linked.primary}
              </p>
              {linked.secondary ? (
                <p className="text-sm font-semibold tabular-nums text-text-faint">{linked.secondary}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1">
              <p
                data-testid="photo-context-ref-missing"
                className="text-sm font-semibold text-stage-soft"
              >
                {linked.missingHeadline}
              </p>
              {linked.missingDetail ? (
                <p className="text-xs leading-snug text-text-faint">{linked.missingDetail}</p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {navLink ? (
        <a
          data-testid="photo-context-source-link"
          href={navLink.href}
          className="flex items-center justify-center gap-2 rounded-lg border border-glass/15 bg-glass/10 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-glass/20"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          {navLink.label}
        </a>
      ) : null}

      <div className="h-px bg-glass/10" />

      {/* Capture metadata */}
      <div className="space-y-4">
        {meta?.takenByStaffName ? (
          <Field icon={<User className="h-3.5 w-3.5" />} label="Taken by">
            {meta.takenByStaffName}
          </Field>
        ) : null}

        {meta?.createdAt ? (
          <Field icon={<Calendar className="h-3.5 w-3.5" />} label="Captured">
            <time dateTime={meta.createdAt} className="tabular-nums">{formatDateTimePST(meta.createdAt)}</time>
          </Field>
        ) : null}

        <Field icon={<ImageIcon className="h-3.5 w-3.5" />} label="Dimensions">
          {photo.naturalWidth && photo.naturalHeight ? (
            <span className="tabular-nums">{photo.naturalWidth} × {photo.naturalHeight} px</span>
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </Field>

        <Field icon={<Sparkles className="h-3.5 w-3.5" />} label="Analysis">
          {analysisNode}
        </Field>

        {meta?.caption ? (
          <Field icon={<FileText className="h-3.5 w-3.5" />} label="Caption">
            <p className="whitespace-pre-wrap text-sm leading-snug text-stage-soft">{meta.caption}</p>
          </Field>
        ) : null}
      </div>
    </motion.aside>
  );
}
