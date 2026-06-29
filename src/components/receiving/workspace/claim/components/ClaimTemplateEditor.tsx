import { Button } from '@/design-system/primitives';
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
  const {
    subject,
    description,
    previewLoading,
    edited,
    onSubjectChange,
    onDescriptionChange,
    resetTemplate,
  } = template;

  return (
    <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
            Zendesk ticket {previewLoading ? '(updating…)' : '(editable)'}
          </p>
          {filedTicket ? (
            <p className="mt-0.5 text-micro font-semibold text-emerald-600">Filed {filedTicket.number}</p>
          ) : null}
        </div>
        {edited ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetTemplate}
            className="text-gray-500 hover:text-gray-900"
          >
            Reset to template
          </Button>
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
        className="mb-3 block h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-label font-medium text-slate-900 shadow-inner outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
      />

      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <label
            htmlFor="claim-body"
            className="block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
          >
            Body
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDescriptionChange('')}
            className="text-slate-400 hover:text-slate-700"
          >
            Clear
          </Button>
        </div>
        <textarea
          id="claim-body"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={8}
          placeholder={previewLoading ? 'Generating…' : 'Ticket body'}
          className="block min-h-[14rem] w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-label font-medium leading-5 tracking-[0.01em] text-slate-900 shadow-inner outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
        />
      </div>
    </div>
  );
}
