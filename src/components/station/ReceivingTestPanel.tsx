'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, X } from '@/components/Icons';
import type { ReceivingQueueItem } from './upnext/upnext-types';

// ─── Failure detail options ───────────────────────────────────────────────────

const FAIL_OPTS = [
  { value: 'FAILED_FUNCTIONAL', label: 'Not Working',  cls: 'bg-rose-500 text-white' },
  { value: 'FAILED_DAMAGED',    label: 'Damaged',      cls: 'bg-red-500 text-white' },
  { value: 'FAILED_INCOMPLETE', label: 'Incomplete',   cls: 'bg-orange-500 text-white' },
  { value: 'HOLD',              label: 'Hold / Retest', cls: 'bg-yellow-400 text-gray-900' },
];

// ─── Workflow step display ─────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { key: 'AWAITING_TEST', label: 'Awaiting' },
  { key: 'IN_TEST',       label: 'In Test' },
  { key: 'PASSED',        label: 'Passed' },
  { key: 'FAILED',        label: 'Failed' },
];

function WorkflowSteps({ current }: { current: string | null }) {
  const activeIdx = WORKFLOW_STEPS.findIndex((s) =>
    current === 'FAILED' || current?.startsWith('FAILED_')
      ? s.key === 'FAILED'
      : s.key === (current ?? 'AWAITING_TEST')
  );
  return (
    <div className="flex items-center gap-0">
      {WORKFLOW_STEPS.map((step, i) => {
        const isCurrent = i === activeIdx;
        const isPast = i < activeIdx;
        return (
          <div key={step.key} className="flex items-center">
            <div className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all ${
              isCurrent
                ? step.key === 'FAILED' ? 'bg-red-500 text-white' : 'bg-teal-600 text-white'
                : isPast
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-400'
            }`}>
              {isCurrent && isPast === false && step.key !== 'FAILED' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1 align-middle" />
              )}
              {isPast && <Check className="inline-block w-2.5 h-2.5 mr-0.5 -mt-0.5" />}
              {step.label}
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div className={`h-px w-4 ${isPast ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ReceivingTestPanelProps {
  item: ReceivingQueueItem;
  onUpdated: () => void;
}

export function ReceivingTestPanel({ item, onUpdated }: ReceivingTestPanelProps) {
  const [phase, setPhase] = useState<'idle' | 'in_test' | 'passed' | 'failed' | 'done'>('idle');
  const [selectedFail, setSelectedFail] = useState<string>('');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Derive starting phase from current assignment status
  const derivedPhase =
    phase !== 'idle'
      ? phase
      : item.status === 'IN_PROGRESS'
      ? 'in_test'
      : item.qa_status === 'PASSED'
      ? 'passed'
      : item.qa_status?.startsWith('FAILED') || item.qa_status === 'HOLD'
      ? 'failed'
      : 'idle';

  const displayWorkflow =
    derivedPhase === 'passed'
      ? 'PASSED'
      : derivedPhase === 'failed' || derivedPhase === 'done'
      ? 'FAILED'
      : derivedPhase === 'in_test'
      ? 'IN_TEST'
      : item.workflow_status ?? 'AWAITING_TEST';

  const handleStartTest = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await fetch('/api/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.assignment_id, status: 'IN_PROGRESS' }),
      });
      setPhase('in_test');
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleVerdict = async (qaStatus: string, completionPhase: 'passed' | 'failed') => {
    setSaving(true);
    setSaveError(false);
    try {
      await Promise.all([
        fetch('/api/receiving-logs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.receiving_id,
            qa_status: qaStatus,
            needs_test: false,
          }),
        }),
        fetch('/api/assignments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.assignment_id,
            status: 'DONE',
            notes: notes.trim() || null,
          }),
        }),
      ]);
      setPhase(completionPhase);
      onUpdated();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!notes.trim()) return;
    setSaving(true);
    setSaveError(false);
    try {
      await fetch('/api/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.assignment_id, notes: notes.trim() }),
      });
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const trackingFull = item.tracking_number ?? '';
  const trackingDisplay = trackingFull.length > 12 ? `…${trackingFull.slice(-10)}` : trackingFull || '—';

  return (
    <div className="bg-white border-t border-teal-100">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-teal-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black text-teal-700 font-mono bg-white border border-teal-200 rounded-lg px-2 py-0.5">
            #{item.receiving_id}
          </span>
          {item.carrier && (
            <span className="text-[9px] font-black text-gray-400 uppercase">{item.carrier}</span>
          )}
          <span className="text-[10px] font-mono font-black text-gray-600 truncate">{trackingDisplay}</span>
        </div>
        {item.assigned_tech_name && (
          <span className="text-[9px] font-black uppercase tracking-wider text-teal-600 flex-shrink-0 ml-2">
            {item.assigned_tech_name}
          </span>
        )}
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Matched SKUs */}
        {item.line_skus.length > 0 && (
          <div className="pt-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">
              Items ({item.line_count})
            </p>
            <div className="flex flex-wrap gap-1">
              {item.line_skus.map((sku, i) => (
                <span
                  key={i}
                  className="text-[9px] font-mono font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-1.5 py-0.5"
                >
                  {sku}
                </span>
              ))}
              {item.line_count > item.line_skus.length && (
                <span className="text-[9px] font-bold text-gray-400">
                  +{item.line_count - item.line_skus.length} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Workflow progress */}
        <div className="overflow-x-auto pb-1">
          <WorkflowSteps current={displayWorkflow} />
        </div>

        {/* ── Phase: idle — Start Test button ── */}
        <AnimatePresence mode="wait">
          {derivedPhase === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                type="button"
                onClick={handleStartTest}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Start Test
              </button>
            </motion.div>
          )}

          {/* ── Phase: in_test — verdict buttons ── */}
          {derivedPhase === 'in_test' && (
            <motion.div
              key="in_test"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Test Outcome</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleVerdict('PASSED', 'passed')}
                  disabled={saving}
                  className="flex items-center justify-center gap-1.5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[12px] font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-emerald-600/20"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Working
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('failed')}
                  disabled={saving}
                  className="flex items-center justify-center gap-1.5 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[12px] font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-red-600/20"
                >
                  <X className="w-4 h-4" />
                  Defective
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Phase: failed — failure detail ── */}
          {derivedPhase === 'failed' && (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Failure Reason</p>
              <div className="grid grid-cols-2 gap-1.5">
                {FAIL_OPTS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedFail(opt.value)}
                    className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border-2 ${
                      selectedFail === opt.value
                        ? `${opt.cls} border-transparent`
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {selectedFail && (
                <button
                  type="button"
                  onClick={() => handleVerdict(selectedFail, 'failed')}
                  disabled={saving}
                  className="w-full py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 mt-1"
                >
                  {saving ? 'Saving…' : 'Confirm & Complete'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPhase('in_test')}
                className="w-full py-1.5 text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Back
              </button>
            </motion.div>
          )}

          {/* ── Phase: passed / done — completion states ── */}
          {(derivedPhase === 'passed' || (derivedPhase === 'done' && phase === 'passed')) && (
            <motion.div
              key="passed"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <Check className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-black text-emerald-800 uppercase tracking-widest">Test Passed</p>
                <p className="text-[9px] text-emerald-600 font-bold mt-0.5">Product marked as working</p>
              </div>
            </motion.div>
          )}

          {(derivedPhase === 'done' && phase !== 'passed') && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <X className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-black text-red-800 uppercase tracking-widest">Test Failed</p>
                <p className="text-[9px] text-red-500 font-bold mt-0.5">
                  {FAIL_OPTS.find((o) => o.value === selectedFail)?.label ?? 'Defective'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notes field — always available */}
        {derivedPhase !== 'passed' && phase !== 'done' && derivedPhase !== 'done' && (
          <div className="space-y-1.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Tech Notes</p>
            <div className="flex gap-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Add testing notes…"
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-700 outline-none focus:border-teal-400 focus:bg-white transition-all"
              />
              {notes.trim() && notes !== (item.notes ?? '') && (
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={saving}
                  className="flex-shrink-0 px-3 py-2 bg-gray-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-all self-end"
                >
                  {saving ? '…' : 'Save'}
                </button>
              )}
            </div>
          </div>
        )}

        {saveError && (
          <p className="text-[9px] font-black uppercase tracking-wider text-red-500 text-center">
            Save failed — check connection
          </p>
        )}
      </div>
    </div>
  );
}
