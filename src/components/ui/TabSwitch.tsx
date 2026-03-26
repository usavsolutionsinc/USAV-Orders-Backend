'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface Tab {
  id: string;
  label: string;
  count?: number;
  color?: 'blue' | 'emerald' | 'orange' | 'purple' | 'green' | 'yellow' | 'gray' | 'red' | 'teal';
}

interface TabSwitchProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
  /** Overrides the default rail container (background, radius, padding). */
  railClassName?: string;
  scrollable?: boolean;
  /** Light gray rail only (no outer chrome); stronger inactive legibility for bright / glare-heavy screens. */
  highContrast?: boolean;
  /** Station up-next queue: tinted rail, semantic tab label hues; outline from `stationChromeOutlineClassName` only. */
  variant?: 'default' | 'upNext';
  /** When `variant` is `upNext`, 1px outline on rail + sliding pill (e.g. `getTechStationLightChromeOutlineClass`). */
  stationChromeOutlineClassName?: string;
}

const colorTextMap: Record<string, { active: string; shadow: string }> = {
  blue:    { active: 'text-blue-600',    shadow: '0 1px 4px 0 rgb(59 130 246 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  emerald: { active: 'text-emerald-600', shadow: '0 1px 4px 0 rgb(16 185 129 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  orange:  { active: 'text-orange-600',  shadow: '0 1px 4px 0 rgb(234 88 12 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  purple:  { active: 'text-purple-600',  shadow: '0 1px 4px 0 rgb(147 51 234 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  green:   { active: 'text-emerald-600', shadow: '0 1px 4px 0 rgb(16 185 129 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  yellow:  { active: 'text-amber-600',   shadow: '0 1px 4px 0 rgb(217 119 6 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  gray:    { active: 'text-slate-600',   shadow: '0 1px 4px 0 rgb(0 0 0 / 0.08), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.05)' },
  red:     { active: 'text-red-600',     shadow: '0 1px 4px 0 rgb(220 38 38 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
  teal:    { active: 'text-teal-600',    shadow: '0 1px 4px 0 rgb(20 184 166 / 0.12), 0 0.5px 1.5px 0 rgb(0 0 0 / 0.06)' },
};

/** Semantic tab label text for `variant="upNext"` (rail/pill outline stays station-themed). */
const upNextLabelTextClass: Record<string, { active: string; inactive: string }> = {
  blue:    { active: 'text-blue-600',    inactive: 'text-blue-600/55 hover:text-blue-700' },
  emerald: { active: 'text-emerald-600', inactive: 'text-emerald-600/55 hover:text-emerald-700' },
  green:   { active: 'text-emerald-600', inactive: 'text-emerald-600/55 hover:text-emerald-700' },
  orange:  { active: 'text-orange-600',  inactive: 'text-orange-600/55 hover:text-orange-700' },
  purple:  { active: 'text-purple-600',  inactive: 'text-purple-600/55 hover:text-purple-700' },
  yellow:  { active: 'text-amber-600',   inactive: 'text-amber-600/55 hover:text-amber-700' },
  gray:    { active: 'text-slate-600',   inactive: 'text-slate-600/55 hover:text-slate-800' },
  red:     { active: 'text-red-600',     inactive: 'text-red-600/55 hover:text-red-700' },
  teal:    { active: 'text-teal-600',    inactive: 'text-teal-600/55 hover:text-teal-700' },
};

const upNextRailBaseClass =
  'rounded-xl bg-neutral-300 p-1.5 shadow-[inset_0_1px_4px_rgba(0,0,0,0.14)]';

/** Shared chrome for sidebar order/view TabSwitch rows (dashboard, repair, etc.). */
export function SidebarTabSwitchChrome({ children }: { children: ReactNode }) {
  return <div className="border-b border-gray-300 px-4 py-3">{children}</div>;
}

export function TabSwitch({
  tabs,
  activeTab,
  onTabChange,
  className = '',
  railClassName,
  scrollable = false,
  highContrast = false,
  variant = 'default',
  stationChromeOutlineClassName,
}: TabSwitchProps) {
  const upNext = variant === 'upNext';
  const upNextOutline = stationChromeOutlineClassName ?? 'border border-neutral-300';
  const defaultRailClass = upNext
    ? `${upNextRailBaseClass} ${upNextOutline}`
    : highContrast
      ? 'rounded-xl bg-neutral-300 p-1.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)]'
      : 'bg-gray-100 rounded-xl p-1';
  const railCombined = railClassName ?? defaultRailClass;
  const railRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const prefersReducedMotion = useReducedMotion();

  const measurePill = useCallback(() => {
    const track = trackRef.current;
    const btn = buttonRefs.current[activeTab];
    if (!track || !btn) {
      setPill((prev) => ({ ...prev, width: 0 }));
      return;
    }
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [activeTab]);

  useLayoutEffect(() => {
    measurePill();
    const id = requestAnimationFrame(() => measurePill());
    return () => cancelAnimationFrame(id);
  }, [measurePill, tabs]);

  useEffect(() => {
    const track = trackRef.current;
    const btn = buttonRefs.current[activeTab];
    if (!track || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measurePill());
    ro.observe(track);
    if (btn) ro.observe(btn);
    return () => ro.disconnect();
  }, [activeTab, measurePill, tabs]);

  useEffect(() => {
    window.addEventListener('resize', measurePill);
    return () => window.removeEventListener('resize', measurePill);
  }, [measurePill]);

  useEffect(() => {
    if (!scrollable) return;
    const rail = railRef.current;
    const activeButton = buttonRefs.current[activeTab];
    if (!rail || !activeButton) return;
    const railWidth = rail.clientWidth;
    const maxScroll = rail.scrollWidth - railWidth;
    const targetLeft = activeButton.offsetLeft + activeButton.offsetWidth / 2 - railWidth / 2;
    const left = Math.max(0, Math.min(targetLeft, Math.max(0, maxScroll)));
    requestAnimationFrame(() => {
      rail.scrollTo({ left, behavior: 'smooth' });
    });
  }, [activeTab, scrollable, tabs]);

  const activeTabColor = tabs.find((t) => t.id === activeTab)?.color ?? 'blue';
  const activeShadow = (colorTextMap[activeTabColor] ?? colorTextMap.blue).shadow;
  const pillShadow = upNext
    ? '0 1px 4px 0 rgb(0 0 0 / 0.16), 0 0.5px 2px 0 rgb(0 0 0 / 0.08)'
    : activeShadow;
  const pillTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, stiffness: 400, damping: 36, mass: 0.78 };

  return (
    <div
      ref={railRef}
      className={`${railCombined} ${scrollable ? 'overflow-x-auto scrollbar-hide' : ''} ${className}`}
    >
      <div
        ref={trackRef}
        className={`relative flex gap-1 ${scrollable ? 'w-max min-w-full' : 'w-full'}`}
      >
        <motion.div
          aria-hidden
          className={`pointer-events-none absolute z-0 rounded-lg bg-white ${
            upNext ? upNextOutline : ''
          }`}
          style={{
            top: 0,
            bottom: 0,
            boxShadow: pillShadow,
          }}
          initial={false}
          animate={{
            left: pill.left,
            width: pill.width,
            opacity: pill.width > 0 ? 1 : 0,
          }}
          transition={pillTransition}
        />
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const colors = colorTextMap[tab.color ?? 'blue'] ?? colorTextMap.blue;
          const upNextLabels = upNextLabelTextClass[tab.color ?? 'blue'] ?? upNextLabelTextClass.blue;
          return (
            <button
              key={tab.id}
              type="button"
              ref={(node) => {
                buttonRefs.current[tab.id] = node;
              }}
              onClick={() => onTabChange(tab.id)}
              className={`relative z-10 flex-1 min-w-[3rem] whitespace-nowrap rounded-lg font-black uppercase tracking-widest transition-colors duration-150 ${
                upNext || highContrast ? 'px-3 py-2 text-[11px]' : 'px-3 py-1.5 text-[10px]'
              } ${
                upNext
                  ? isActive
                    ? upNextLabels.active
                    : upNextLabels.inactive
                  : isActive
                    ? colors.active
                    : highContrast
                      ? 'text-neutral-800 hover:text-neutral-950'
                      : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <motion.span
                className="relative z-10 flex items-center justify-center gap-1"
                animate={{
                  scale: isActive ? 1 : upNext || highContrast ? 0.98 : 0.93,
                  opacity: isActive ? 1 : upNext ? 1 : highContrast ? 0.9 : 0.52,
                }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <motion.span
                    key={tab.count}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                    className={`inline-flex items-center justify-center min-w-[14px] h-[14px] px-[3px] rounded-full text-[8px] font-black tabular-nums leading-none ${
                      upNext
                        ? 'bg-current/[0.14] text-current'
                        : isActive
                          ? 'bg-current/[0.12] text-current'
                          : highContrast
                            ? 'bg-neutral-600/20 text-neutral-900'
                            : 'bg-gray-300/70 text-gray-600'
                    }`}
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </motion.span>
                )}
              </motion.span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
