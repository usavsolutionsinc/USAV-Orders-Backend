import { toast } from '@/lib/toast';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import type { ClaimType } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimPhotoPicker } from './ClaimPhotoPicker';
import { ClaimTemplateEditor } from './ClaimTemplateEditor';

function reasonPlaceholder(claimType: ClaimType): string {
  if (claimType === 'damage') return 'Crushed packaging, dent on side panel…';
  if (claimType === 'missing') return '2 of 3 units missing from package…';
  if (claimType === 'wrong_item') return 'Received model XL2 instead of MX5…';
  return 'Inconsistent QA, multiple units DOA…';
}

/** Create → internal step: pick claim type, describe it, attach photos, edit the ticket. */
export function ClaimInternalStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <div>
        <p className="mb-1.5 text-micro font-black uppercase tracking-[0.14em] text-gray-500">Claim type</p>
        <HorizontalButtonSlider
          items={c.claimTypeItems}
          value={c.claimType}
          onChange={(id) => c.setClaimType(id as ClaimType)}
          variant="nav"
          size="md"
          aria-label="Claim type"
        />
      </div>

      <div>
        <label
          htmlFor="claim-reason"
          className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-gray-500"
        >
          What happened?
        </label>
        <textarea
          id="claim-reason"
          value={c.reason}
          onChange={(e) => c.setReason(e.target.value)}
          rows={3}
          placeholder={reasonPlaceholder(c.claimType)}
          className="block w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-medium leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
        />
      </div>

      <ClaimPhotoPicker photos={c.photos} />

      <ClaimTemplateEditor template={c.template} filedTicket={c.filedTicket} />

      <p className="text-micro font-semibold leading-snug text-gray-500">
        Auto-fills from PO, tracking, photos, and the active line. Filing creates the internal
        ticket, then step 2 drafts the external seller message with the ticket #.
      </p>

      {c.draftBody ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-micro font-black uppercase tracking-widest text-amber-700">
            Zendesk unreachable — copy this body to Zendesk
          </p>
          <textarea
            readOnly
            value={c.draftBody}
            rows={6}
            className="mt-1.5 block w-full resize-none rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-micro text-gray-800 outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => {
              const body = c.draftBody;
              if (!body) return;
              void navigator.clipboard.writeText(body).then(() => {
                toast.success('Body copied to clipboard');
              });
            }}
            className="mt-1.5 text-micro font-bold uppercase tracking-widest text-amber-700 hover:text-amber-900"
          >
            Copy to clipboard
          </button>
        </div>
      ) : null}
    </>
  );
}
