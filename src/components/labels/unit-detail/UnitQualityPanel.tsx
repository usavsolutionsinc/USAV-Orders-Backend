'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Wrench, AlertTriangle, Check, ShieldCheck } from '@/components/Icons';
import { timeAgo } from '@/utils/_date';

/**
 * Quality + failures + repairs for one serial unit — the QC system's read+act
 * surface in the detail pane. One aggregate read (GET .../quality, self-healing
 * recompute) feeds three cards; writes (tag / resolve / log repair / complete)
 * invalidate it. Server enforces permissions; the UI just surfaces the actions.
 */

interface QualityScore {
  quality_score: number;
  risk_level: 'low' | 'medium' | 'high';
  risk_reasons: string[];
  ebay_condition_id: string | null;
  grade_at_score: string | null;
  computed_at: string;
}
interface FailureTag {
  id: number;
  failure_mode_id: number;
  code?: string;
  label?: string;
  severity?: string;
  source: string;
  resolution_status: string;
  detected_by_name?: string | null;
  detected_at: string;
  notes: string | null;
}
interface RepairRow {
  id: number;
  status: string;
  summary: string;
  cost_cents: number | null;
  labor_minutes: number | null;
  started_by_name?: string | null;
  completed_by_name?: string | null;
  created_at: string;
  completed_at: string | null;
  failure_modes?: { id: number; code: string; label: string }[];
}
interface QualityResp {
  ok: boolean;
  grade: string | null;
  current_status: string | null;
  quality: QualityScore | null;
  failure_tags: FailureTag[];
  repairs: RepairRow[];
}
interface FailureMode {
  id: number;
  code: string;
  label: string;
  severity: string;
  category: string;
}

const CARD = 'rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60';
const HEAD = 'text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500';

const RISK_TONE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const SEV_TONE: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  major: 'bg-amber-50 text-amber-700 border-amber-200',
  minor: 'bg-gray-50 text-gray-600 border-gray-200',
};
const REPAIR_TONE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  in_progress: 'bg-blue-50 text-blue-700',
  pending: 'bg-gray-100 text-gray-600',
  failed: 'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

function prettyReason(r: string): string {
  return r.replace(/_/g, ' ');
}
function dollars(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

export function UnitQualityPanel({ serialUnitId }: { serialUnitId: number }) {
  const qc = useQueryClient();
  const key = ['unit.quality', serialUnitId] as const;

  const { data, isLoading, isError } = useQuery<QualityResp>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/quality`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as QualityResp;
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['serial-unit.detail'] });
  };

  if (isLoading) {
    return (
      <section className={CARD}>
        <div className="flex items-center gap-2 px-5 py-4 text-caption text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading quality…
        </div>
      </section>
    );
  }
  if (isError || !data) return null;

  return (
    <>
      <QualityCard quality={data.quality} grade={data.grade} />
      <FailureTagsCard
        serialUnitId={serialUnitId}
        tags={data.failure_tags}
        onChanged={invalidate}
      />
      <RepairsCard
        serialUnitId={serialUnitId}
        repairs={data.repairs}
        openFailureModes={data.failure_tags
          .filter((t) => t.resolution_status === 'open')
          .map((t) => ({ id: t.failure_mode_id, label: t.label ?? t.code ?? `#${t.failure_mode_id}` }))}
        onChanged={invalidate}
      />
    </>
  );
}

/* ─────────────────────────── Quality ─────────────────────────── */

function QualityCard({ quality, grade }: { quality: QualityScore | null; grade: string | null }) {
  if (!quality) return null;
  const tone = RISK_TONE[quality.risk_level] ?? RISK_TONE.medium;
  const barColor =
    quality.risk_level === 'low' ? 'bg-emerald-500' : quality.risk_level === 'medium' ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <section className={`${CARD} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={HEAD}>Quality</h3>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wider ring-1 ${tone}`}>
          <ShieldCheck className="h-3 w-3" /> {quality.risk_level} risk
        </span>
      </div>
      <div className="flex items-end gap-3">
        <span className="text-4xl font-black tabular-nums text-gray-900">{quality.quality_score}</span>
        <span className="pb-1 text-caption font-semibold text-gray-400">/ 100</span>
        <div className="ml-auto text-right text-micro text-gray-400">
          {grade ? <div className="font-bold text-gray-700">{grade}</div> : null}
          {quality.ebay_condition_id ? <div>eBay cond {quality.ebay_condition_id}</div> : null}
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${quality.quality_score}%` }} />
      </div>
      {quality.risk_reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {quality.risk_reasons.map((r) => (
            <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-medium text-gray-600">
              {prettyReason(r)}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-micro text-gray-400">Updated {timeAgo(quality.computed_at)}</p>
    </section>
  );
}

/* ─────────────────────────── Failure tags ─────────────────────────── */

function FailureTagsCard({
  serialUnitId,
  tags,
  onChanged,
}: {
  serialUnitId: number;
  tags: FailureTag[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [modeId, setModeId] = useState('');
  const [note, setNote] = useState('');

  const modes = useQuery<FailureMode[]>({
    queryKey: ['failure-modes', 'active'],
    enabled: adding,
    queryFn: async () => {
      const res = await fetch('/api/failure-modes?activeOnly=1', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      return json.modes as FailureMode[];
    },
    staleTime: 60_000,
  });

  const addTag = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/failure-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failureModeId: Number(modeId), source: 'manual', notes: note.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => { setAdding(false); setModeId(''); setNote(''); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not tag failure'),
  });

  const resolveTag = useMutation({
    mutationFn: async (tagId: number) => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/failure-tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId, resolutionStatus: 'resolved' }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    },
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resolve'),
  });

  const open = tags.filter((t) => t.resolution_status === 'open');
  const resolved = tags.filter((t) => t.resolution_status !== 'open');

  return (
    <section className={CARD}>
      <header className="flex items-center justify-between px-5 py-4">
        <h3 className={HEAD}>Failure tags</h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> Tag
        </button>
      </header>

      {adding && (
        <div className="border-t border-gray-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={modeId}
              onChange={(e) => setModeId(e.target.value)}
              className="min-w-[12rem] flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-caption font-medium text-gray-900"
            >
              <option value="">{modes.isLoading ? 'Loading…' : 'Select failure mode…'}</option>
              {(modes.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.label} ({m.severity})</option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-[8rem] flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-caption font-medium text-gray-900 placeholder:text-gray-400"
            />
            <button
              type="button"
              disabled={!modeId || addTag.isPending}
              onClick={() => addTag.mutate()}
              className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {addTag.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
            </button>
          </div>
        </div>
      )}

      {tags.length === 0 ? (
        <p className="border-t border-gray-100 px-5 py-3 text-caption text-gray-400">No failures tagged.</p>
      ) : (
        <ul className="border-t border-gray-100 divide-y divide-gray-100">
          {[...open, ...resolved].map((t) => {
            const isOpen = t.resolution_status === 'open';
            return (
              <li key={t.id} className="flex items-start gap-2 px-5 py-3">
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${isOpen ? 'text-rose-500' : 'text-gray-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-label font-bold ${isOpen ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                      {t.label ?? t.code ?? `Mode #${t.failure_mode_id}`}
                    </span>
                    {t.severity && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV_TONE[t.severity] ?? SEV_TONE.minor}`}>
                        {t.severity}
                      </span>
                    )}
                    {!isOpen && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">{t.resolution_status}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-micro text-gray-500">
                    {timeAgo(t.detected_at)} · {t.source}{t.detected_by_name ? ` · ${t.detected_by_name}` : ''}
                  </div>
                  {t.notes && <p className="mt-0.5 text-caption text-gray-600">{t.notes}</p>}
                </div>
                {isOpen && (
                  <button
                    type="button"
                    disabled={resolveTag.isPending}
                    onClick={() => resolveTag.mutate(t.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Resolve
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── Repairs ─────────────────────────── */

function RepairsCard({
  serialUnitId,
  repairs,
  openFailureModes,
  onChanged,
}: {
  serialUnitId: number;
  repairs: RepairRow[];
  openFailureModes: { id: number; label: string }[];
  onChanged: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [summary, setSummary] = useState('');
  const [linked, setLinked] = useState<Set<number>>(new Set());

  const openRepair = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/repairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summary.trim(), failureModeIds: [...linked] }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => { setOpening(false); setSummary(''); setLinked(new Set()); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not open repair'),
  });

  const completeRepair = useMutation({
    mutationFn: async (args: { id: number; costDollars: string }) => {
      const cents = args.costDollars.trim() ? Math.round(parseFloat(args.costDollars) * 100) : undefined;
      const res = await fetch(`/api/serial-units/${serialUnitId}/repairs/${args.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', costCents: Number.isFinite(cents) ? cents : undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    },
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not complete repair'),
  });

  return (
    <section className={CARD}>
      <header className="flex items-center justify-between px-5 py-4">
        <h3 className={HEAD}>Repair history</h3>
        <button
          type="button"
          onClick={() => setOpening((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> Log repair
        </button>
      </header>

      {opening && (
        <div className="space-y-2 border-t border-gray-100 px-5 py-3">
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What's being repaired?"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-medium text-gray-900 placeholder:text-gray-400"
          />
          {openFailureModes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {openFailureModes.map((m) => {
                const on = linked.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setLinked((s) => {
                      const n = new Set(s);
                      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                      return n;
                    })}
                    className={`rounded-full border px-2 py-0.5 text-micro font-medium transition-colors ${
                      on ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {on ? '✓ ' : ''}{m.label}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            disabled={!summary.trim() || openRepair.isPending}
            onClick={() => openRepair.mutate()}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {openRepair.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
            Open repair
          </button>
        </div>
      )}

      {repairs.length === 0 ? (
        <p className="border-t border-gray-100 px-5 py-3 text-caption text-gray-400">No repairs logged.</p>
      ) : (
        <ul className="border-t border-gray-100 divide-y divide-gray-100">
          {repairs.map((r) => (
            <RepairRowItem key={r.id} repair={r} onComplete={(costDollars) => completeRepair.mutate({ id: r.id, costDollars })} completing={completeRepair.isPending} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RepairRowItem({
  repair,
  onComplete,
  completing,
}: {
  repair: RepairRow;
  onComplete: (costDollars: string) => void;
  completing: boolean;
}) {
  const [cost, setCost] = useState('');
  const terminal = ['completed', 'failed', 'scrapped'].includes(repair.status);
  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${REPAIR_TONE[repair.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {repair.status.replace(/_/g, ' ')}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-bold text-gray-900">{repair.summary}</span>
        {repair.cost_cents != null && <span className="text-micro font-semibold text-gray-500">{dollars(repair.cost_cents)}</span>}
      </div>
      <div className="mt-0.5 text-micro text-gray-500">
        {timeAgo(repair.created_at)}
        {repair.started_by_name ? ` · ${repair.started_by_name}` : ''}
        {repair.completed_at ? ` · done ${timeAgo(repair.completed_at)}` : ''}
      </div>
      {repair.failure_modes && repair.failure_modes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {repair.failure_modes.map((m) => (
            <span key={m.id} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{m.label}</span>
          ))}
        </div>
      )}
      {!terminal && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            placeholder="Cost $ (opt)"
            className="w-28 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-caption font-medium text-gray-900 placeholder:text-gray-400"
          />
          <button
            type="button"
            disabled={completing}
            onClick={() => onComplete(cost)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Complete
          </button>
        </div>
      )}
    </li>
  );
}
