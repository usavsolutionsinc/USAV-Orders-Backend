import { Archive, FileText, Image as ImageIcon, Loader2, Mail, Tag } from '@/components/Icons';
import { CLAIM_TYPE_OPTIONS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { claimThumb } from '../claim-helpers';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/** A read-only labelled section: eyebrow above, value below. */
function ReviewBlock({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-text-faint">{icon}</span>
        <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">{label}</p>
        {hint ? <span className="text-micro font-semibold text-text-faint">· {hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Step 3 — Review. Read-only summary before filing. Submit lives in the footer.
 */
export function ClaimReviewStep({ c }: { c: ReceivingClaimController }) {
  const { template, photos, row } = c;
  const subject = template.subject.trim();
  const body = template.description.trim();
  const selected = photos.photos.filter((p) => photos.selectedPhotoIds.has(p.id));

  const claimLabel =
    CLAIM_TYPE_OPTIONS.find((o) => o.value === c.claimType)?.label ?? c.claimType;
  const folderFallback =
    String(row.zoho_purchaseorder_number || '').trim() || `RCV-${row.receiving_id ?? ''}`;

  return (
    <div className="divide-y divide-border-hairline space-y-0 [&>section]:py-3 [&>section:first-child]:pt-0 [&>div]:py-3">
      <ReviewBlock icon={<Tag className="h-3.5 w-3.5" />} label="Claim type">
        <span className="text-caption font-bold uppercase tracking-wide text-rose-700">
          {claimLabel}
        </span>
      </ReviewBlock>

      <ReviewBlock
        icon={<ImageIcon className="h-3.5 w-3.5" />}
        label="Evidence photos"
        hint={
          photos.photos.length
            ? `${selected.length} attaching · ${photos.photos.length} backing up`
            : 'none on this carton'
        }
      >
        {selected.length ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1">
            {selected.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={claimThumb(p.url, p.id)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-14 w-14 shrink-0 rounded bg-surface-sunken object-cover ring-1 ring-border-soft"
              />
            ))}
          </div>
        ) : (
          <p className="text-caption font-medium text-text-faint">No photos selected to attach.</p>
        )}
      </ReviewBlock>

      <ReviewBlock
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Zendesk ticket"
        hint={template.previewLoading ? 'updating…' : undefined}
      >
        <div className="overflow-hidden rounded-lg border border-border-soft">
          <p className="border-b border-border-soft px-3 py-2 text-label font-bold text-text-default">
            {subject || <span className="font-medium text-rose-500">No subject yet</span>}
          </p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-caption font-medium leading-5 text-text-muted">
            {body || <span className="text-rose-500">No body yet</span>}
          </p>
        </div>
      </ReviewBlock>

      <ReviewBlock
        icon={<Mail className="h-3.5 w-3.5" />}
        label="Recipients"
        hint={c.notePublic ? 'public reply' : 'internal note'}
      >
        {c.notePublic ? (
          c.ccEmails.length ? (
            <div className="flex flex-wrap gap-1.5">
              {c.ccEmails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-caption font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
                >
                  {email}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-caption font-medium text-text-muted">
              Public reply — emails the requester (no CC added).
            </p>
          )
        ) : (
          <p className="text-caption font-medium text-text-muted">
            Internal note — not emailed to anyone.
          </p>
        )}
      </ReviewBlock>

      <ReviewBlock icon={<Archive className="h-3.5 w-3.5" />} label="Local backup">
        <p className="text-caption font-medium text-text-muted">
          {photos.photos.length || 0} {photos.photos.length === 1 ? 'photo' : 'photos'} → folder
          after case # <span className="font-bold text-text-default">{folderFallback}</span>
        </p>
      </ReviewBlock>

      {c.submitting || c.archiveSubmitting ? (
        <div className="flex items-center gap-2 text-caption font-semibold text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {c.submitting ? 'Filing ticket…' : 'Saving photos…'}
        </div>
      ) : null}
    </div>
  );
}
