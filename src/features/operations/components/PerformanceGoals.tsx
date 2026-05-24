'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Sparkles, AlertCircle } from '@/components/Icons';
import { sectionLabel, cardTitle } from '@/design-system/tokens/typography/presets';

/* ─── Radial Ring ────────────────────────────────────────────────── */

interface RadialRingProps {
  percentage: number;
  label: string;
  countLabel: string;
  color: string;
  ringBgColor: string;
}

function RadialRing({ percentage, label, countLabel, color, ringBgColor }: RadialRingProps) {
  const radius = 28;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex items-center gap-4 bg-[#FAFAF8] border border-[#E8E4DD] p-4 rounded-2xl transition-all duration-200 hover:shadow-sm">
      <div className="relative w-[68px] h-[68px] shrink-0">
        <svg className="w-full h-full transform -rotate-90">
          {/* Base track */}
          <circle
            cx="34"
            cy="34"
            r={radius}
            stroke={ringBgColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {/* Animated progress segment */}
          <motion.circle
            cx="34"
            cy="34"
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[12px] font-black text-[#2D2A26] tracking-tighter tabular-nums">
            {percentage}%
          </span>
        </div>
      </div>
      <div className="text-left space-y-0.5">
        <p className={`${sectionLabel} !text-[#A89F91]`}>{label}</p>
        <h4 className="text-[13px] font-black text-[#2D2A26] leading-tight pr-1">
          {countLabel}
        </h4>
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */

export function PerformanceGoals() {
  return (
    <section className="bg-white rounded-3xl shadow-[0_4px_24px_rgba(161,140,90,0.06)] p-8 select-none">
      {/* ── Section Header ─────────────────────────────────────── */}
      <div className="mb-8">
        <span className={`${sectionLabel} !text-[#A89F91]`}>PERFORMANCE TRACKER</span>
        <h2 className={`${cardTitle} !text-[#2D2A26] mt-1`}>Goals &amp; Progress</h2>
      </div>

      {/* ── Sub-section 1: Daily Milestones ────────────────────── */}
      <div className="mb-8">
        <span className={`${sectionLabel} !text-[#A89F91] mb-3 block`}>
          01 // DAILY MILESTONES
        </span>
        <div className="grid grid-cols-2 gap-4">
          <RadialRing
            percentage={92}
            label="Inbound Intake"
            countLabel="320 of 350 Units Catalogued"
            color="#6B9080"
            ringBgColor="#E8E4DD"
          />
          <RadialRing
            percentage={68}
            label="Technician Bench"
            countLabel="17 of 25 Refurbished"
            color="#E07A5F"
            ringBgColor="#E8E4DD"
          />
        </div>
      </div>

      {/* ── Divider ────────────────────────────────────────────── */}
      <div className="border-t border-[#E8E4DD] mb-8" />

      {/* ── Sub-section 2: Weekly Forecast ─────────────────────── */}
      <div className="mb-8">
        <span className={`${sectionLabel} !text-[#A89F91] mb-3 block`}>
          02 // WEEKLY PACE
        </span>

        <div className="bg-[#FAFAF8] border border-[#E8E4DD] p-5 rounded-2xl space-y-4">
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] font-black text-[#A89F91] uppercase tracking-wider">
              Weekly Target
            </span>
            <span className="text-[14px] font-black text-[#2D2A26] tabular-nums">
              1,480{' '}
              <span className="text-[11px] text-[#A89F91] font-medium">/ 1,800 units</span>
            </span>
          </div>

          {/* Amber progress bar */}
          <div className="space-y-1.5">
            <div className="h-2 w-full bg-[#E8E4DD] rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '82%' }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className="h-full bg-[#F59E0B] rounded-full"
              />
            </div>
            <div className="flex justify-between text-[9px] font-black text-[#A89F91] uppercase tracking-wider mt-1.5">
              <span>Current pace</span>
              <span>82% complete</span>
            </div>
          </div>

          <p className="text-[12px] text-[#6B6356] font-medium leading-relaxed">
            You&apos;re on track to exceed last week by{' '}
            <span className="font-extrabold text-[#2D2A26]">8.4%</span> 🚀
          </p>
        </div>
      </div>

      {/* ── Divider ────────────────────────────────────────────── */}
      <div className="border-t border-[#E8E4DD] mb-8" />

      {/* ── Sub-section 3: Smart Recommendations ───────────────── */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles className="w-3.5 h-3.5 text-[#D97706]" />
          <span className={`${sectionLabel} !text-[#D97706]`}>03 // RECOMMENDATIONS</span>
        </div>
        <h3 className={`${cardTitle} !text-[#2D2A26] mb-4`}>Smart Recommendations</h3>

        <div className="space-y-3">
          {/* Card 1: FBA Warning */}
          <motion.div
            whileHover={{ y: -1.5 }}
            className="flex items-start gap-3.5 p-3.5 bg-amber-50/50 hover:bg-amber-50 border-l-2 border-l-[#F59E0B] border-y border-r border-[#E8E4DD] rounded-r-xl cursor-pointer transition-colors duration-150"
          >
            <div className="w-7 h-7 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3.5 h-3.5 text-[#D97706]" />
            </div>
            <div className="text-left space-y-0.5">
              <p className="text-[12px] font-bold text-[#2D2A26] leading-snug">
                Replenish Amazon FBA inventory soon
              </p>
              <p className="text-[10px] text-[#A89F91] font-semibold leading-normal mt-0.5">
                SKU USAV-CBL-04 inventory low (9 days remaining). Click to create shipment.
              </p>
            </div>
          </motion.div>

          {/* Card 2: Support Ticket Queue Alert */}
          <motion.div
            whileHover={{ y: -1.5 }}
            className="flex items-start gap-3.5 p-3.5 bg-[#E07A5F]/[0.04] hover:bg-[#E07A5F]/[0.08] border-l-2 border-l-[#E07A5F] border-y border-r border-[#E8E4DD] rounded-r-xl cursor-pointer transition-colors duration-150"
          >
            <div className="w-7 h-7 rounded-lg bg-[#E07A5F]/10 flex items-center justify-center shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-[#E07A5F]" />
            </div>
            <div className="text-left space-y-0.5">
              <p className="text-[12px] font-bold text-[#2D2A26] leading-snug">
                Critical Ticket Backlog
              </p>
              <p className="text-[10px] text-[#A89F91] font-semibold leading-normal mt-0.5">
                4 repairs waiting more than 48h. Tap to assign urgent technician dispatch.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
