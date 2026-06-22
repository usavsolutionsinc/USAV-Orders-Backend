import { ClipboardList } from '@/components/Icons';
import { WORKFLOW_BADGE, QA_BADGE, DISP_BADGE } from '@/components/station/receiving-constants';

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function KV({ label, value, span2 = false }: { label: string; value: string; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <dt className="text-micro uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

export function WorkflowBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${WORKFLOW_BADGE[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

export function QABadge({ status }: { status: string }) {
  if (!status || status === 'PENDING') return null;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${QA_BADGE[status] ?? 'bg-slate-100 text-slate-700'}`}>
      QA: {status}
    </span>
  );
}

export function DispositionBadge({ code }: { code: string }) {
  if (!code || code === 'HOLD') return null;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${DISP_BADGE[code] ?? 'bg-slate-100 text-slate-700'}`}>
      {code}
    </span>
  );
}

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <ClipboardList className="h-10 w-10 text-emerald-200" />
      <div className="mt-3 text-base font-medium text-slate-800">Pick a purchase order</div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Select a PO from the list to see every event captured for it — when each package arrived,
        when each line item was unboxed, tested, dispositioned, and put away.
      </p>
    </div>
  );
}
