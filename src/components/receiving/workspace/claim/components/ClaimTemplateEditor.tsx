import type { FiledTicket } from '../claim-types';
import type { UseClaimTemplate } from '../hooks/useClaimTemplate';

interface Props {
  template: UseClaimTemplate;
  filedTicket: FiledTicket | null;
}

/**
 * Editable Zendesk subject + body, populated from the server preview. Once the
 * operator edits a field we stop overwriting it; "Reset to template" refetches.
 */
export function ClaimTemplateEditor({ template, filedTicket }: Props) {
  const { subject, description, previewLoading, edited, onSubjectChange, onDescriptionChange, resetTemplate } =
    template;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
            Zendesk ticket {previewLoading ? '(updating…)' : '(editable)'}
          </p>
          {filedTicket ? (
            <p className="mt-0.5 text-[10px] font-semibold text-emerald-600">Filed {filedTicket.number}</p>
          ) : null}
        </div>
        {edited ? (
          <button
            type="button"
            onClick={resetTemplate}
            className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
          >
            Reset to template
          </button>
        ) : null}
      </div>

      <label
        htmlFor="claim-subject"
        className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
      >
        Subject
      </label>
      <input
        id="claim-subject"
        type="text"
        value={subject}
        onChange={(e) => onSubjectChange(e.target.value)}
        placeholder={previewLoading ? 'Generating…' : 'Subject'}
        className="mb-3 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-semibold text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
      />

      <label
        htmlFor="claim-body"
        className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
      >
        Body
      </label>
      <textarea
        id="claim-body"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        rows={10}
        placeholder={previewLoading ? 'Generating…' : 'Ticket body'}
        className="block w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-caption leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
      />
    </div>
  );
}
