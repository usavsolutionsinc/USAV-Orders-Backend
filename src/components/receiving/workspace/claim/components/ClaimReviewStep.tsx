import { Archive, FileText, Image as ImageIcon, Loader2, Tag } from '@/components/Icons';
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
        <span className="text-gray-400">{icon}</span>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">{label}</p>
        {hint ? <span className="text-[10px] font-semibold text-gray-400">· {hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Step 3 — Review. A single read-only summary of everything that is about to
 * happen: the claim type, the photos that will attach + back up, the exact
 * Zendesk subject/body, and the NAS folder the evidence lands in. The Submit
 * action lives in the footer; on success the flow advances to Confirmation.
 */
export function ClaimReviewStep({ c }: { c: ReceivingClaimController }) {
  const { template, photos, row } = c;
  const subject = template.subject.trim();
  const body = template.description.trim();
  const selected = photos.photos.filter((p) => photos.selectedPhotoIds.has(p.id));

  const claimLabel =
    CLAIM_TYPE_OPTIONS.find((o) => o.value === c.claimType)?.label ?? c.claimType;
  // The auto-archive on file names the folder after the new case #; until then
  // show the same fallback the controller uses (PO #, else receiving id).
  const folderFallback =
    String(row.zoho_purchaseorder_number || '').trim() || `RCV-${row.receiving_id ?? ''}`;

  return (
    <div className="space-y-4">
      <ReviewBlock icon={<Tag className="h-3.5 w-3.5" />} label="Claim type">
        <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-700 ring-1 ring-inset ring-rose-200">
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
          <div className="grid grid-cols-10 gap-1">
            {selected.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={claimThumb(p.url, p.id)}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded bg-gray-100 object-cover ring-1 ring-rose-200"
              />
            ))}
          </div>
        ) : (
          <p className="text-[11px] font-medium text-gray-400">No photos selected to attach.</p>
        )}
      </ReviewBlock>

      <ReviewBlock
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Zendesk ticket"
        hint={template.previewLoading ? 'updating…' : undefined}
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <p className="border-b border-slate-200 px-3 py-2 text-label font-bold text-slate-900">
            {subject || <span className="font-medium text-rose-500">No subject yet</span>}
          </p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-caption font-medium leading-5 text-slate-700">
            {body || <span className="text-rose-500">No body yet</span>}
          </p>
        </div>
      </ReviewBlock>

      <ReviewBlock icon={<Archive className="h-3.5 w-3.5" />} label="NAS backup">
        <p className="text-[11px] font-medium leading-5 text-gray-600">
          On file, the office NAS agent copies the {photos.photos.length || 'carton'}
          {photos.photos.length === 1 ? ' photo' : ' photos'} into a folder named after the new case
          # (fallback{' '}
          <span className="font-bold text-gray-800">{folderFallback}</span>) and writes a{' '}
          <span className="font-bold text-gray-800">case-info.txt</span> notepad with the ticket
          details alongside them.
        </p>
      </ReviewBlock>

      {c.submitting ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Filing ticket &amp; backing up photos…
        </div>
      ) : null}
    </div>
  );
}
