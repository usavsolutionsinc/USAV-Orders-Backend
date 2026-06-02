'use client';

/**
 * Design-system pattern menu for the Testing page tightening pass.
 *
 * Self-contained on purpose — no auth, data, or live workspace. Every pattern
 * is shown as labeled, copy-pasteable variants so you can cherry-pick. The
 * variants marked "Shipped" are the ones already applied to
 * {@link TechTestingWorkspace} + {@link SkuTestingPanel}. Visit /design-demo.
 *
 * Nothing here is imported by the app — delete the route any time.
 */

import { useState } from 'react';
import { Printer, Plus, Check } from '@/components/Icons';

/* ─────────────────────── chosen tokens (what shipped) ─────────────────────── */

const TOKENS = {
  section: 'rounded-2xl bg-white p-4 ring-1 ring-gray-200/70',
  sectionHero: 'overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70',
  eyebrow: 'text-[11px] font-semibold text-gray-400',
  hairline: 'ring-gray-200/70',
  row: 'rounded-lg border border-gray-200/70 bg-white',
  motion: 'transition-colors duration-150',
} as const;

/* ──────────────────────────── tiny copy helper ───────────────────────────── */

function ClassCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy className"
      className="group mt-2 flex w-full items-center gap-2 rounded-md border border-gray-200/70 bg-gray-50/80 px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-gray-600 transition-colors duration-150 hover:border-gray-300 hover:bg-white"
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <span className="shrink-0 text-[9px] font-sans font-semibold uppercase tracking-wider text-gray-400 group-hover:text-blue-600">
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

function Shipped() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
      <Check className="h-2.5 w-2.5" /> Shipped
    </span>
  );
}

/* ───────────────────────────── layout shells ─────────────────────────────── */

function PatternSection({
  title,
  rationale,
  children,
}: {
  title: string;
  rationale: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold tracking-tight text-gray-900">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-gray-500">{rationale}</p>
      </div>
      {children}
    </section>
  );
}

function Variant({
  label,
  note,
  shipped = false,
  code,
  children,
}: {
  label: string;
  note?: string;
  shipped?: boolean;
  code?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-gray-200/70 bg-gray-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{label}</span>
        {shipped ? <Shipped /> : null}
      </div>
      <div className="flex flex-1 items-center justify-center rounded-xl bg-white/40 p-4">
        {children}
      </div>
      {note ? <p className="mt-2 text-[11px] leading-snug text-gray-500">{note}</p> : null}
      {code ? <ClassCode value={code} /> : null}
    </div>
  );
}

/* ─────────────────────────── mock card content ───────────────────────────── */

function MockChecklist({ eyebrowClass, rowClass }: { eyebrowClass: string; rowClass: string }) {
  const steps = [
    { label: 'Power-on self test', done: true },
    { label: 'Ports & I/O verified', done: true },
    { label: 'Cosmetic grade confirmed', done: false },
  ];
  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={eyebrowClass}>Testing checklist</h3>
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
          2/3 done
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li
            key={s.label}
            className={`flex items-center gap-2 px-3 py-2 ${rowClass} ${
              s.done ? 'border-emerald-200 bg-emerald-50/60' : ''
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${
                s.done
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-gray-300 bg-white text-transparent'
              }`}
            >
              ✓
            </span>
            <span className="text-[11px] font-semibold text-gray-900">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── the page ────────────────────────────────── */

export default function DesignDemoPage() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="mx-auto w-full max-w-5xl space-y-10 px-5 py-10">
        {/* hero header — dogfoods SECTION_HERO */}
        <header className={`${TOKENS.sectionHero} p-6`}>
          <p className={TOKENS.eyebrow}>Design system · Testing page</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
            Tighten-up pattern menu
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">
            The patterns behind the testing-page polish, each as side-by-side variants. Click any
            class string to copy it. <Shipped /> marks the variant already live on the testing
            workspace — the rest are alternatives to cherry-pick.
          </p>
        </header>

        {/* 1 — ELEVATION */}
        <PatternSection
          title="1 · Elevation hierarchy"
          rationale="Stop giving every card equal weight. Flat hairline cards for the body; one elevated 'hero' surface (the carton header) the eye anchors to first."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Variant
              label="Flat hairline"
              shipped
              note="Body cards. Crisp 1px ring, no shadow — reads more premium than uniform soft shadows."
              code={TOKENS.section}
            >
              <div className={`${TOKENS.section} w-full`}>
                <p className={TOKENS.eyebrow}>Notes</p>
                <div className="mt-2 h-10 rounded-md border border-gray-200/70 bg-white" />
              </div>
            </Variant>
            <Variant
              label="Soft shadow (old)"
              note="The previous uniform treatment. Fine, but every card floats equally → no hierarchy."
              code="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60"
            >
              <div className="w-full rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
                <p className={TOKENS.eyebrow}>Notes</p>
                <div className="mt-2 h-10 rounded-md border border-gray-200 bg-white" />
              </div>
            </Variant>
            <Variant
              label="Hero"
              shipped
              note="The ONE elevated surface. Hairline ring + a single shadow-sm so it sits above the flat cards."
              code={TOKENS.sectionHero}
            >
              <div className={`${TOKENS.sectionHero} w-full p-4`}>
                <p className={TOKENS.eyebrow}>Carton</p>
                <div className="mt-2 h-10 rounded-md bg-gray-100" />
              </div>
            </Variant>
          </div>
        </PatternSection>

        {/* 2 — RADIUS */}
        <PatternSection
          title="2 · Radius scale"
          rationale="Lock nesting to one hierarchy. A 6px corner inside a 12px inside a 16px looks accidental; 16 → 8 → 6 looks designed."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Variant
              label="Tightened · 16 → 8 → 6"
              shipped
              note="Card rounded-2xl, rows rounded-lg, chips/controls rounded-md."
              code="card: rounded-2xl · row: rounded-lg · control: rounded-md"
            >
              <div className="w-full rounded-2xl bg-white p-3 ring-1 ring-gray-200/70">
                <div className="rounded-lg border border-gray-200/70 p-2">
                  <div className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-500">
                    control
                  </div>
                </div>
              </div>
            </Variant>
            <Variant
              label="Mixed (old) · 16 → 12 → 6"
              note="rounded-2xl → rounded-xl → rounded-md. The jump from row to control reads inconsistent."
              code="card: rounded-2xl · row: rounded-xl · control: rounded-md"
            >
              <div className="w-full rounded-2xl bg-white p-3 ring-1 ring-gray-200/60">
                <div className="rounded-xl border border-gray-200 p-2">
                  <div className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-500">
                    control
                  </div>
                </div>
              </div>
            </Variant>
          </div>
        </PatternSection>

        {/* 3 — EYEBROW TYPOGRAPHY */}
        <PatternSection
          title="3 · Section labels (eyebrow)"
          rationale="Quiet the labels so content becomes the hierarchy. Lower weight + muted color + controlled tracking — highest-impact, lowest-risk change."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Variant
              label="Quiet"
              code="text-eyebrow font-semibold uppercase tracking-[0.12em] text-gray-400"
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                Testing checklist
              </span>
            </Variant>
            <Variant
              label="Heavy (old)"
              code="text-eyebrow font-black uppercase tracking-widest text-gray-500"
            >
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                Testing checklist
              </span>
            </Variant>
            <Variant
              label="Mono"
              note="Engineer-tool flavor."
              code="font-mono text-[10px] uppercase tracking-[0.1em] text-gray-400"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-gray-400">
                Testing checklist
              </span>
            </Variant>
            <Variant
              label="Minimal"
              shipped
              note="No uppercase — softest option."
              code="text-caption font-semibold text-gray-400"
            >
              <span className="text-[11px] font-semibold text-gray-400">Testing checklist</span>
            </Variant>
          </div>
        </PatternSection>

        {/* 4 — FULL CARD COMBO */}
        <PatternSection
          title="4 · Composed card"
          rationale="The tokens together. Left is what shipped; right is the old treatment for reference."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Variant label="Tightened" shipped>
              <div className={`${TOKENS.section} w-full`}>
                <MockChecklist
                  eyebrowClass="text-[11px] font-semibold text-gray-400"
                  rowClass="rounded-lg border border-gray-200/70 bg-white transition-colors duration-150"
                />
              </div>
            </Variant>
            <Variant label="Old">
              <div className="w-full rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
                <MockChecklist
                  eyebrowClass="text-[9px] font-black uppercase tracking-widest text-gray-500"
                  rowClass="rounded-xl border border-gray-200 bg-white"
                />
              </div>
            </Variant>
          </div>
        </PatternSection>

        {/* 5 — MOTION */}
        <PatternSection
          title="5 · Motion"
          rationale="States should fade, not snap. Colors-only transitions are GPU-cheap; a tiny active scale makes touch targets feel tactile. Hover / press the buttons below."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Variant
              label="Color fade"
              shipped
              note="Every hoverable element."
              code="transition-colors duration-150"
            >
              <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 transition-colors duration-150 hover:bg-blue-50">
                <Plus className="h-3.5 w-3.5" /> Add step
              </button>
            </Variant>
            <Variant
              label="Press scale"
              shipped
              note="Checkboxes / verdict toggles."
              code="transition-all duration-150 active:scale-95"
            >
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-600 bg-emerald-600 text-white transition-all duration-150 active:scale-95">
                <Check className="h-4 w-4" />
              </button>
            </Variant>
            <Variant
              label="Primary CTA"
              note="The Pass + Print action."
              code="transition-colors duration-150 hover:bg-emerald-700"
            >
              <button className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-bold text-white transition-colors duration-150 hover:bg-emerald-700">
                <Printer className="h-4 w-4" /> Pass · Print
              </button>
            </Variant>
          </div>
        </PatternSection>

        {/* 6 — STICKY BAR */}
        <PatternSection
          title="6 · Action bar"
          rationale="A compact pill floating centered at the bottom with just the CTA — lighter than a full-bleed bar, and the content scrolls behind it. Now a `floating` variant on the StickyActionBar design-system component."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Variant
              label="Floating CTA"
              shipped
              note="StickyActionBar floating prop. No bar chrome — the CTA spans the panel max-width + gutter and hovers above the scroll surface."
              code="<StickyActionBar floating primary={…} />"
            >
              <div className="relative h-28 w-full overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200/70">
                <div className="space-y-1 p-2">
                  <div className="h-3 w-2/3 rounded bg-gray-200/70" />
                  <div className="h-3 w-1/2 rounded bg-gray-200/70" />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3">
                  <button className="pointer-events-auto flex h-10 w-full items-center justify-center rounded-xl bg-emerald-600 text-[11px] font-bold text-white transition-colors duration-150 hover:bg-emerald-700">
                    Pass · Print
                  </button>
                </div>
              </div>
            </Variant>
            <Variant
              label="Hairline bar"
              note="Full-bleed bar — crisp top hairline + blurred backdrop. The component default."
              code="border-t border-gray-200/70 bg-white/95 backdrop-blur"
            >
              <div className="w-full overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200/70">
                <div className="h-12 bg-gray-50" />
                <div className="flex items-center justify-between border-t border-gray-200/70 bg-white/95 px-3 py-2.5 backdrop-blur">
                  <span className="text-[10px] font-medium text-gray-400">1× copies</span>
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white">
                    Pass · Print
                  </button>
                </div>
              </div>
            </Variant>
            <Variant label="Flat (old)" code="bg-gray-50">
              <div className="w-full overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200/60">
                <div className="h-12 bg-gray-50" />
                <div className="flex items-center justify-between bg-gray-50 px-3 py-2.5">
                  <span className="text-[10px] font-medium text-gray-400">1× copies</span>
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white">
                    Pass · Print
                  </button>
                </div>
              </div>
            </Variant>
          </div>
        </PatternSection>

        {/* token cheat-sheet */}
        <PatternSection
          title="Token cheat-sheet"
          rationale="The full set in one place. These are the constants now living at the top of TechTestingWorkspace + SkuTestingPanel."
        >
          <div className={`${TOKENS.section} space-y-1`}>
            {Object.entries(TOKENS).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 py-1">
                <span className="w-24 shrink-0 font-mono text-[11px] font-semibold text-gray-900">
                  {k}
                </span>
                <span className="min-w-0 flex-1 font-mono text-[11px] text-gray-500">{v}</span>
              </div>
            ))}
          </div>
        </PatternSection>

        <footer className="pt-2 text-center text-[11px] text-gray-400">
          Throwaway route · not imported by the app · delete{' '}
          <span className="font-mono">src/app/design-demo</span> any time.
        </footer>
      </div>
    </div>
  );
}
