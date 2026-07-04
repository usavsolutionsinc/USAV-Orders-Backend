'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle, Calendar, ExternalLink, FileText, Image as ImageIcon,
  Layers, Package, Sparkles, User,
} from '../../Icons';
import { formatDateTimePST } from '@/utils/date';
import { useZendeskTicketSubject } from '@/hooks/useZendeskTicketSubject';
import { claimsTicketLabel } from '@/lib/photos/display-names';
import type { PhotoItem, PhotoMeta } from './photo-gallery-utils';

/**
 * Right-side info panel for the fullscreen viewer — the "where did this photo
 * come from" surface. Modeled on the detail panels in Air / Dropbox / Savee
 * (Mobbin): a source badge, a deep link back to the originating PO/ticket, and
 * compact metadata rows (uploader, capture time, dimensions, analysis verdict,
 * caption). Styled for the dark lightbox, not the light app chrome.
 */

type SourceKind = 'unboxing' | 'packing' | 'claims' | 'unknown';

interface SourceDescriptor {
  kind: SourceKind;
  label: string;
  /** Tailwind classes for the badge (kept to generated shades, no hardcoded hex). */
  tone: string;
  Icon: typeof Package;
}

/**
 * Resolve a photo's source from its meta. Prefer explicit signals (a linked
 * Zendesk ticket = a claim; the library scope when not "all") and fall back to
 * the denormalized `photoType` so "All photos" rows still badge correctly.
 */
function describeSource(meta: PhotoMeta): SourceDescriptor {
  const scope = meta.sourceScope;
  const type = (meta.photoType ?? '').toUpperCase();
  const isClaim = meta.ticketId != null || scope === 'claims' || type.includes('CLAIM');
  const isPacking =
    scope === 'packing' || type.includes('PACK') || type.includes('PACKER');

  if (isClaim) {
    return { kind: 'claims', label: 'Zendesk claim', tone: 'bg-amber-500/15 text-amber-200 ring-amber-400/30', Icon: FileText };
  }
  if (isPacking) {
    return { kind: 'packing', label: 'Packing', tone: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', Icon: Layers };
  }
  if (scope === 'unboxing' || type.includes('RECEIV') || type.includes('UNBOX')) {
    return { kind: 'unboxing', label: 'Unboxing', tone: 'bg-blue-500/15 text-blue-200 ring-blue-400/30', Icon: Package };
  }
  return { kind: 'unknown', label: 'Photo', tone: 'bg-glass/10 text-stage-soft ring-glass/20', Icon: ImageIcon };
}

/** Reference shown under the badge (PO 123 / Order 123 / Ticket #4821). */
function sourceRefLabel(source: SourceDescriptor, meta: PhotoMeta): string | null {
  if (source.kind === 'claims') return meta.ticketId != null ? claimsTicketLabel(meta.ticketId) : null;
  if (!meta.poRef) return null;
  if (source.kind === 'packing') return `Order ${meta.poRef}`;
  if (source.kind === 'unboxing') return `PO ${meta.poRef}`;
  return meta.poRef;
}

/**
 * Build a deep link back into the library, scoped to everything from this
 * photo's source — the loop-closing complement to the inbound deep links the
 * library already accepts (`?poRef=`, `?entityType=ZENDESK_TICKET&entityId=`).
 */
function sourceHref(source: SourceDescriptor, meta: PhotoMeta): string | null {
  if (source.kind === 'claims' && meta.ticketId != null) {
    return `/ops/photos?sourceScope=claims&entityType=ZENDESK_TICKET&entityId=${meta.ticketId}`;
  }
  if (meta.poRef) {
    const scope = source.kind === 'packing' ? 'packing' : source.kind === 'unboxing' ? 'unboxing' : 'all';
    return `/ops/photos?sourceScope=${scope}&poRef=${encodeURIComponent(meta.poRef)}`;
  }
  return null;
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

export function PhotoContextPanel({ photo }: { photo: PhotoItem | undefined }) {
  const meta = photo?.meta;
  // Hook must run unconditionally; it self-disables for null/invalid ids.
  const ticketSubject = useZendeskTicketSubject(meta?.ticketId ?? null);

  if (!photo) return null;

  const source = meta ? describeSource(meta) : {
    kind: 'unknown' as const,
    label: 'Photo',
    tone: 'bg-glass/10 text-stage-soft ring-glass/20',
    Icon: ImageIcon,
  };
  const refLabel = meta ? sourceRefLabel(source, meta) : null;
  const href = meta ? sourceHref(source, meta) : null;
  const SourceIcon = source.Icon;

  const analysisNode = meta?.damageDetected
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-200 ring-1 ring-inset ring-rose-400/30"><AlertTriangle className="h-3.5 w-3.5" /> Damage detected</span>
    : meta?.hasAnalysis
      ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/30"><Sparkles className="h-3.5 w-3.5" /> Analyzed · clear</span>
      : <span className="text-xs text-text-faint">Not analyzed yet</span>;

  return (
    <motion.aside
      data-testid="photo-context-panel"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      aria-label="Photo details"
      className="relative z-20 flex h-full w-80 max-w-[85vw] shrink-0 flex-col gap-5 overflow-y-auto border-l border-glass/10 bg-scrim/60 px-5 pb-5 pt-20 backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Source badge + reference — pt-20 + pr-14 keeps the header below the
          window-pinned close (X) control in the top-right corner. */}
      <div className="space-y-2 pr-14">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wider ring-1 ring-inset ${source.tone}`}>
          <SourceIcon className="h-3.5 w-3.5" />
          {source.label}
        </span>
        {source.kind === 'claims' ? (
          <div className="space-y-1">
            <p data-testid="photo-context-ref" className="text-base font-bold leading-snug text-white">
              {ticketSubject.data || refLabel || 'Linked claim'}
            </p>
            {ticketSubject.data && refLabel ? (
              <p className="text-sm font-semibold tabular-nums text-text-faint">{refLabel}</p>
            ) : null}
          </div>
        ) : refLabel ? (
          <p data-testid="photo-context-ref" className="text-base font-bold text-white">{refLabel}</p>
        ) : (
          <p className="text-sm text-text-faint">Not linked to a source</p>
        )}
      </div>

      {href ? (
        <a
          data-testid="photo-context-source-link"
          href={href}
          className="flex items-center justify-center gap-2 rounded-lg border border-glass/15 bg-glass/10 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-glass/20"
        >
          <ExternalLink className="h-4 w-4" />
          View all from this source
        </a>
      ) : null}

      <div className="h-px bg-glass/10" />

      {/* Metadata fields */}
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
