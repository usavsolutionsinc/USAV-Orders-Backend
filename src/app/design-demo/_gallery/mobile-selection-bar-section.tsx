'use client';

/**
 * 4m · Mobile selection bar — the liquid-glass capsule (Aurora drift).
 *
 * One {@link MobileSelectionBar}: an ultra-thin, full-round, compact glass pill
 * that floats above the home indicator the moment you highlight a row.
 * Now promoted to @/design-system/components/MobileSelectionBar.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Share2, Star, DollarSign } from '@/components/Icons';
import { MobileSelectionBar, type MobileSelectionAction } from '@/design-system/components';
import { cn } from '@/utils/_cn';
import { type Density } from './sections';

/* ─────────────────────────── sample data ──────────────────────────────── */

type Order = { id: string; sku: string; title: string; qty: number; price: string };

const ORDERS: Order[] = [
  { id: 'SO-4821', sku: 'MBP-16-M3', title: 'MacBook Pro 16″ M3', qty: 2, price: '$4,998' },
  { id: 'SO-4822', sku: 'IPH-15-PRO', title: 'iPhone 15 Pro', qty: 1, price: '$1,199' },
  { id: 'SO-4823', sku: 'DELL-XPS13', title: 'Dell XPS 13', qty: 4, price: '$5,196' },
  { id: 'SO-4824', sku: 'SONY-WH1000', title: 'Sony WH-1000XM5', qty: 3, price: '$1,047' },
  { id: 'SO-4825', sku: 'IPAD-AIR-11', title: 'iPad Air 11″', qty: 1, price: '$599' },
  { id: 'SO-4826', sku: 'GPX-RTX5090', title: 'RTX 5090 FE', qty: 1, price: '$1,999' },
] as const;

const spring = { type: 'spring', stiffness: 520, damping: 38 } as const;

const rowPad: Record<Density, string> = {
  compact: 'py-2',
  cozy: 'py-2.5',
  comfortable: 'py-3.5',
};

/* ─────────────────────── shared selection hook ────────────────────────── */

function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allOn = sel.size === ORDERS.length;
  return useMemo(
    () => ({
      count: sel.size,
      allOn,
      has: (id: string) => sel.has(id),
      toggle: (id: string) =>
        setSel((s) => {
          const n = new Set(s);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }),
      toggleAll: () => setSel((s) => (s.size === ORDERS.length ? new Set() : new Set(ORDERS.map((o) => o.id)))),
      clear: () => setSel(new Set()),
    }),
    [sel, allOn],
  );
}

type Sel = ReturnType<typeof useSelection>;

/* ───────────────────────────── phone frame ────────────────────────────── */

function Phone({ sel, density, children }: { sel: Sel; density: Density; children: React.ReactNode }) {
  return (
    <div className="relative h-[460px] w-full max-w-[300px] overflow-hidden rounded-[2.25rem] border border-border-soft bg-surface-canvas shadow-xl ring-1 ring-black/[0.03]">
      <div className="pointer-events-none absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-black/80" />
      <div className="flex items-center justify-between px-4 pb-2 pt-9">
        <span className="text-[13px] font-bold tracking-tight text-text-default">Orders</span>
        <span className="font-mono text-[10px] tabular-nums text-text-muted">{sel.count}/{ORDERS.length}</span>
      </div>
      <div className="h-[calc(460px-72px)] overflow-y-auto px-2.5 pb-28">
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.04 } },
          }}
          className="space-y-1.5"
        >
          {ORDERS.map((o) => (
            <Row key={o.id} order={o} on={sel.has(o.id)} onTap={() => sel.toggle(o.id)} density={density} />
          ))}
        </motion.ul>
      </div>
      {children}
    </div>
  );
}

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: spring },
};

function Row({ order, on, onTap, density }: { order: Order; on: boolean; onTap: () => void; density: Density }) {
  return (
    <motion.li layout variants={rowVariants}>
      <motion.button
        onClick={onTap}
        whileTap={{ scale: 0.985 }}
        animate={{
          backgroundColor: on ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0)',
          boxShadow: on ? 'inset 0 0 0 1px rgba(59, 130, 246, 0.3)' : 'inset 0 0 0 1px rgba(59, 130, 246, 0)',
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-2.5 text-left',
          rowPad[density],
          !on && 'hover:bg-surface-card',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
            on ? 'border-blue-600 bg-blue-600 text-white' : 'border-border-soft bg-surface-card',
          )}
        >
          <AnimatePresence>
            {on && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
                <Check className="h-3 w-3" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-text-default">{order.title}</span>
          <span className="block font-mono text-[10px] text-text-muted">{order.id} · {order.qty}×</span>
        </span>
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-text-default">{order.price}</span>
      </motion.button>
    </motion.li>
  );
}

/* ───────────────────────────── bay shell ──────────────────────────────── */

function GlassBay({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border-soft bg-surface-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight text-text-default">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-text-muted">{sub}</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-500/20">
          Glass
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-gradient-to-br from-surface-canvas to-surface-card p-4 ring-1 ring-border-soft/60">
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────────── section ────────────────────────────────── */

export function MobileSelectionBarSection({ density }: { density: Density }) {
  const sel = useSelection();

  const actions: MobileSelectionAction[] = [
    { key: 'share', label: 'Share', icon: Share2, onTap: () => console.log('Share') },
    { key: 'highlight', label: 'Highlight', icon: Star, onTap: () => console.log('Highlight') },
    { key: 'quote', label: 'Quote', icon: DollarSign, onTap: () => console.log('Quote') },
  ];

  return (
    <div>
      <p className="mb-3 rounded-xl border border-dashed border-border-soft bg-surface-card px-3 py-2 text-[11px] leading-relaxed text-text-muted">
        The promoted <span className="font-semibold text-text-default">MobileSelectionBar</span> component. Tap rows to trigger the glass capsule. It now uses a single high-performance aurora drift and is fully reusable. <code className="font-mono text-[10px]">@/design-system/components/MobileSelectionBar</code>
      </p>
      <div className="flex items-center justify-center">
        <GlassBay title="Mobile Selection Bar" sub="Slower aurora in a glassier, heavily-blurred frosted capsule — diffuse, breathing color.">
          <Phone sel={sel} density={density}>
            <MobileSelectionBar
              count={sel.count}
              total={ORDERS.length}
              allSelected={sel.allOn}
              onToggleAll={sel.toggleAll}
              onClear={sel.clear}
              actions={actions}
            />
          </Phone>
        </GlassBay>
      </div>
    </div>
  );
}

export default MobileSelectionBarSection;
