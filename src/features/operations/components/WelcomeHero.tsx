'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Search } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';

export function WelcomeHero() {
  const { user } = useAuth();
  const [greeting, setGreeting] = useState('Welcome');
  const [staffName, setStaffName] = useState('');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    fetch(`/api/staff?id=${user.staffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (cancelled || !data?.staff) return;
        if (data.staff.name) setStaffName(data.staff.name);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [user]);

  const firstName = staffName.split(' ')[0];

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full"
    >
      {/* Greeting + sub */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A89F91]">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
        <h1 className="text-[34px] sm:text-[44px] lg:text-[52px] font-extrabold text-[#2D2A26] tracking-[-0.02em] leading-[1.05]">
          {greeting}{firstName ? `, ` : ''}
          {firstName && (
            <span className="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 bg-clip-text text-transparent">
              {firstName}
            </span>
          )}
          <span className="text-[#C4BAA8]"> 👋</span>
        </h1>
        <p className="text-[14px] sm:text-[16px] text-[#6B6356] font-medium max-w-xl leading-relaxed">
          Here’s how the floor is moving today. Take a look, then dive in.
        </p>
      </div>

      {/* Ask-anything chip + live pace pill (mobile stacks, sm+ side-by-side) */}
      <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="button"
          className="group flex items-center gap-3 w-full sm:w-auto sm:min-w-[340px]
                     bg-white border border-[#E8E4DD] rounded-full px-4 py-3
                     shadow-[0_2px_12px_rgba(161,140,90,0.06)]
                     hover:shadow-[0_4px_20px_rgba(161,140,90,0.10)]
                     hover:border-amber-300 transition-all duration-200 text-left"
        >
          <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
            <Search className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <span className="flex-1 text-[13px] font-medium text-[#A89F91]">
            Ask anything — “show repairs over 48h”
          </span>
          <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-black text-[#A89F91] bg-[#F5F3EF] border border-[#E8E4DD] rounded-md px-1.5 py-0.5">
            ⌘ K
          </kbd>
        </button>

        <div className="flex items-center gap-2.5 bg-[#1F1C19] text-white rounded-full pl-2 pr-4 py-2 self-start">
          <div className="relative w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center">
            <Activity className="w-3.5 h-3.5 text-amber-300" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
          </div>
          <div className="leading-none">
            <span className="text-[8px] font-black uppercase tracking-[0.18em] text-white/50 block mb-1">
              Live pace
            </span>
            <span className="text-[13px] font-extrabold tabular-nums">
              42 <span className="text-white/50 text-[10px] font-medium">orders / min</span>
            </span>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
