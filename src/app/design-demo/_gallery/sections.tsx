'use client';

/**
 * 2026 component showroom — the live, cherry-pick gallery.
 *
 * Every export below is a *working* modernized component rendered in its real
 * states. Nothing here is wired into the app yet: this is the menu. When you
 * pick one, we "promote" it to the path shown in its <Bay> header
 * (e.g. @/design-system/primitives/Button) and start replacing the hand-rolled
 * versions. Built entirely on the stack you already ship: Tailwind + Framer
 * Motion 11 + Sonner + your CSS-variable design tokens.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Plus,
  Printer,
  Trash2,
  X,
  Package,
  AlertTriangle,
  Sparkles,
  Settings,
} from '@/components/Icons';

import { Button, TextField, type ButtonVariant, StaggerReveal, StaggerRevealItem } from '@/design-system/primitives';

/* ════════════════════════ shared gallery furniture ════════════════════════ */

export type Density = 'compact' | 'cozy' | 'comfortable';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;
const softSpring = { type: 'spring', stiffness: 320, damping: 30 } as const;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Pill marking whether a component is new vs. already in the system. */
function Tag({ kind }: { kind: 'new' | 'have' | 'upgrade' | 'standard' }) {
  const map = {
    new: ['bg-emerald-500/12 text-emerald-600 ring-emerald-500/20', '2026 · New'],
    upgrade: ['bg-violet-500/12 text-violet-600 ring-violet-500/20', '2026 · Upgrade'],
    have: ['bg-slate-500/10 text-text-muted ring-border-soft', 'In system'],
    standard: ['bg-blue-500/12 text-blue-600 ring-blue-500/20', '2026 · Standard'],
  } as const;
  const [cls, label] = map[kind];
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1', cls)}>
      {label}
    </span>
  );
}

/**
 * One catalog entry: title, "promote to" path, live render surface, optional
 * caption. The dashed promote path is the whole point — it tells you where the
 * component lands the moment you cherry-pick it.
 */
export function Bay({
  title,
  promote,
  tag = 'new',
  caption,
  children,
  span = 1,
}: {
  title: string;
  promote: string;
  tag?: 'new' | 'have' | 'upgrade' | 'standard';
  caption?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div
      className={cx(
        'flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4',
        span === 2 && 'sm:col-span-2',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">{title}</h3>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">{promote}</code>
        </div>
        <Tag kind={tag} />
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-surface-canvas/60 p-5 ring-1 ring-border-soft/60">
        {children}
      </div>
      {caption ? <p className="mt-2.5 text-[11px] leading-snug text-text-muted">{caption}</p> : null}
    </div>
  );
}

export function SectionHeading({ index, title, blurb }: { index: string; title: string; blurb: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-text-muted">{index}</span>
        <h2 className="text-lg font-bold tracking-tight text-text-default">{title}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-muted">{blurb}</p>
    </div>
  );
}

const densityPad: Record<Density, string> = {
  compact: 'py-1.5',
  cozy: 'py-2.5',
  comfortable: 'py-3.5',
};

/* ════════════════════════════ 1 · BUTTONS ═════════════════════════════════ */

// Promoted: this card now renders the real primitive at
// @/design-system/primitives/Button. The local shim only adapts the gallery's
// `icon={Plus}` (component) call sites to Button's `icon={<Plus />}` node API.
function Btn({
  children,
  variant = 'primary',
  loading,
  className,
  icon: Icon,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Button
      variant={variant}
      loading={loading}
      className={className}
      icon={Icon ? <Icon /> : undefined}
    >
      {children}
    </Button>
  );
}

export function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Bay
        title="Button — variants"
        promote="@/design-system/primitives/Button"
        tag="upgrade"
        caption="One <Button variant> replaces the ad-hoc <button className> scattered across sidebars. Spring press feedback on every variant."
        span={2}
      >
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Btn variant="primary" icon={Plus}>Primary</Btn>
          <Btn variant="brand" icon={Sparkles}>Brand</Btn>
          <Btn variant="secondary" icon={Settings}>Secondary</Btn>
          <Btn variant="ghost">Ghost</Btn>
          <Btn variant="danger" icon={Trash2}>Danger</Btn>
        </div>
      </Bay>
      <Bay
        title="Button — async state"
        promote="@/design-system/primitives/Button"
        tag="upgrade"
        caption="Built-in loading prop. Click to see the spinner swap — no more manual disable+spinner wiring per form."
      >
        <Btn
          variant="primary"
          icon={Printer}
          loading={loading}
          className="min-w-[140px]"
        >
          <span
            onClick={() => {
              if (loading) return;
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1600);
            }}
          >
            {loading ? 'Printing…' : 'Pass · Print'}
          </span>
        </Btn>
      </Bay>
    </div>
  );
}

/* ════════════════════════ 3 · INPUTS ══════════════════════════════════════ */

/** Thin stateful wrapper over the real {@link TextField} primitive for the showroom. */
function FloatField({ label, type = 'text' }: { label: string; type?: string }) {
  const [v, setV] = useState('');
  return <TextField label={label} value={v} onChange={setV} type={type} />;
}

export function InputsSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay title="Floating-label field" promote="@/design-system/primitives/TextField" tag="new" caption="Label animates into the border on focus/fill. Replaces the static label-above-input forms.">
        <div className="w-full max-w-[220px] space-y-3">
          <FloatField label="Order ID" />
          <FloatField label="Tracking #" />
        </div>
      </Bay>
      <Bay title="Toggle switch" promote="@/design-system/primitives/Switch" tag="new" caption="Spring-driven thumb. For settings & filters.">
        <SwitchDemo />
      </Bay>
    </div>
  );
}

function SwitchDemo() {
  const [on, setOn] = useState(true);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className={cx('flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-200', on ? 'bg-emerald-500' : 'bg-slate-300')}
    >
      <motion.span layout transition={spring} className={cx('h-6 w-6 rounded-full bg-white shadow', on && 'ml-auto')} />
    </button>
  );
}

/* ════════════════════════ 4 · DATA DISPLAY ════════════════════════════════ */

const ROWS = [
  { id: 'SO-4821', sku: 'MBP-16-M3', qty: 2, status: 'Shipped', carrier: 'UPS' },
  { id: 'SO-4822', sku: 'IPH-15-PRO', qty: 1, status: 'Packing', carrier: '—' },
  { id: 'SO-4823', sku: 'DELL-XPS13', qty: 4, status: 'Pending', carrier: '—' },
  { id: 'SO-4824', sku: 'SONY-WH1000', qty: 3, status: 'Shipped', carrier: 'FedEx' },
] as const;

const statusTone: Record<string, string> = {
  Shipped: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25',
  Packing: 'bg-amber-500/12 text-amber-600 ring-amber-500/25',
  Pending: 'bg-slate-500/10 text-text-muted ring-border-soft',
};

export function DataTableSection({ density }: { density: Density }) {
  const [sel, setSel] = useState<string[]>(['SO-4821']);
  const all = sel.length === ROWS.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="grid grid-cols-1 gap-3">
      <Bay
        title="DataTable — selection · status · density"
        promote="@/design-system/components/DataTable"
        tag="new"
        caption="One table family replaces ~6 hand-rolled sticky-header tables. Reacts to the density toggle in the toolbar. Hover a row; toggle the checkboxes."
        span={2}
      >
        <div className="w-full overflow-hidden rounded-xl border border-border-soft bg-surface-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-soft bg-surface-canvas/70 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={() => setSel(all ? [] : ROWS.map((r) => r.id))}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                </th>
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">SKU</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Carrier</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => {
                const on = sel.includes(r.id);
                return (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...softSpring, delay: i * 0.04 }}
                    onClick={() => toggle(r.id)}
                    className={cx(
                      'cursor-pointer border-b border-border-soft/70 text-[12px] transition-colors duration-150 last:border-0',
                      on ? 'bg-blue-500/[0.06]' : 'hover:bg-surface-canvas/70',
                    )}
                  >
                    <td className={cx('px-3', densityPad[density])}>
                      <input type="checkbox" checked={on} readOnly className="h-3.5 w-3.5 accent-blue-600" />
                    </td>
                    <td className={cx('px-3 font-mono font-semibold text-text-default', densityPad[density])}>{r.id}</td>
                    <td className={cx('px-3 font-mono text-text-muted', densityPad[density])}>{r.sku}</td>
                    <td className={cx('px-3 text-right tabular-nums text-text-default', densityPad[density])}>{r.qty}</td>
                    <td className={cx('px-3', densityPad[density])}>
                      <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', statusTone[r.status])}>
                        {r.status}
                      </span>
                    </td>
                    <td className={cx('px-3 text-text-muted', densityPad[density])}>{r.carrier}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bay>
    </div>
  );
}

/* ════════════════════════ 5 · FEEDBACK ════════════════════════════════════ */

export function FeedbackSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay title="Empty state" promote="@/components/ui/EmptyState" tag="upgrade" caption="Illustrated zero-state with a primary action. You have EmptyState — this adds polish + CTA.">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-canvas ring-1 ring-border-soft">
            <Package className="h-6 w-6 text-text-muted" />
          </div>
          <p className="text-[13px] font-semibold text-text-default">No pending orders</p>
          <p className="mt-0.5 max-w-[200px] text-[11px] text-text-muted">Everything's shipped. New orders land here automatically.</p>
          <Btn variant="primary" icon={Plus} className="mt-3"><span>Create manual order</span></Btn>
        </div>
      </Bay>
      <Bay title="Error / inline banner" promote="@/design-system/components/InlineNotice" tag="new" caption="Consistent error + warning surface for failed syncs, validation, etc.">
        <div className="w-full space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/[0.08] p-3 ring-1 ring-rose-500/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="text-[12px] font-semibold text-rose-700">Zoho sync failed</p>
              <p className="text-[11px] text-rose-600/80">Token expired — reconnect the integration.</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/[0.08] p-3 ring-1 ring-amber-500/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[12px] font-semibold text-amber-700">3 orders missing tracking numbers</p>
          </div>
        </div>
      </Bay>
    </div>
  );
}

/* ════════════════════════ 7 · MOTION LAB ══════════════════════════════════ */

export function MotionSection() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Bay title="Shared-element expand" promote="motion layoutId" tag="new" caption="Click the card — it morphs open with a shared layout transition. The pattern behind detail-panel reveals.">
        <ExpandCard />
      </Bay>
      <Bay title="Spring press" promote="whileTap" tag="new" caption="Press-and-hold tactility on any control.">
        <motion.button whileTap={{ scale: 0.88 }} transition={spring} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
          <Check className="h-5 w-5" />
        </motion.button>
      </Bay>
      <Bay title="Stagger reveal" promote="@/design-system/primitives/StaggerReveal" tag="new" caption="List items cascade in. For freshly-loaded queues. Live on the receiving + testing rails.">
        <StaggerList />
      </Bay>
    </div>
  );
}

function ExpandCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-28 items-center justify-center">
      <AnimatePresence mode="wait">
        {!open ? (
          <motion.button
            layoutId="exp"
            onClick={() => setOpen(true)}
            transition={softSpring}
            className="flex items-center gap-2 rounded-2xl border border-border-soft bg-surface-card px-4 py-3 shadow-sm"
          >
            <motion.span layoutId="exp-dot" className="h-8 w-8 rounded-xl bg-blue-600" />
            <motion.span layoutId="exp-label" className="text-[12px] font-semibold text-text-default">SO-4821</motion.span>
          </motion.button>
        ) : (
          <motion.div
            layoutId="exp"
            onClick={() => setOpen(false)}
            transition={softSpring}
            className="w-full max-w-[220px] cursor-pointer rounded-2xl border border-border-soft bg-surface-card p-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <motion.span layoutId="exp-dot" className="h-8 w-8 rounded-xl bg-blue-600" />
              <motion.span layoutId="exp-label" className="text-[12px] font-semibold text-text-default">SO-4821</motion.span>
            </div>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[11px] text-text-muted">
              2× MBP-16-M3 · UPS · ships today. Tap to collapse.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StaggerList() {
  const [key, setKey] = useState(0);
  return (
    <div className="w-full max-w-[180px]">
      <StaggerReveal replayKey={key} step={0.08} className="space-y-1.5">
        {['SO-4821', 'SO-4822', 'SO-4823'].map((o) => (
          <StaggerRevealItem
            key={o}
            className="rounded-lg border border-border-soft bg-surface-card px-3 py-2 font-mono text-[11px] font-semibold text-text-default"
          >
            {o}
          </StaggerRevealItem>
        ))}
      </StaggerReveal>
      <button onClick={() => setKey((k) => k + 1)} className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline">
        Replay ↻
      </button>
    </div>
  );
}
