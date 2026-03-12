'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

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
  scrollable?: boolean;
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

export function TabSwitch({ tabs, activeTab, onTabChange, className = '', scrollable = false }: TabSwitchProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!scrollable) return;
    const rail = railRef.current;
    const activeButton = buttonRefs.current[activeTab];
    if (!rail || !activeButton) return;
    const railWidth = rail.clientWidth;
    const maxScroll = rail.scrollWidth - railWidth;
    const targetLeft = activeButton.offsetLeft + activeButton.offsetWidth / 2 - railWidth / 2;
    const left = Math.max(0, Math.min(targetLeft, Math.max(0, maxScroll)));
    rail.scrollTo({ left, behavior: 'smooth' });
  }, [activeTab, scrollable, tabs]);

  const activeTabColor = tabs.find((t) => t.id === activeTab)?.color ?? 'blue';
  const activeShadow = (colorTextMap[activeTabColor] ?? colorTextMap.blue).shadow;

  return (
    <div
      ref={railRef}
      className={`bg-gray-100 rounded-xl p-1 ${scrollable ? 'overflow-x-auto scrollbar-hide' : ''} ${className}`}
    >
      {/* flex-1 on each button + min-w-[3rem] = always fills width equally;
          when many tabs overflow min-w the container scrolls instead of squishing */}
      <div className="flex gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const colors = colorTextMap[tab.color ?? 'blue'] ?? colorTextMap.blue;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttonRefs.current[tab.id] = node;
              }}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex-1 min-w-[3rem] whitespace-nowrap px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors duration-150 ${
                isActive ? colors.active : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="tab-switch-active-pill"
                  className="absolute inset-0 rounded-lg bg-white"
                  style={{ boxShadow: activeShadow }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 34,
                    mass: 0.75,
                  }}
                />
              )}
              <motion.span
                className="relative z-10 flex items-center justify-center gap-1"
                animate={{
                  scale: isActive ? 1 : 0.93,
                  opacity: isActive ? 1 : 0.52,
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
                      isActive
                        ? 'bg-current/[0.12] text-current'
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
