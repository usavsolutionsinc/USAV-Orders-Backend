'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { Barcode, AlertCircle, Loader2, Check } from '../Icons';
import ActiveStationOrderCard from './ActiveStationOrderCard';
import { useStationTestingController } from '@/hooks/useStationTestingController';

interface StationTestingProps {
  userId: string;
  userName: string;
  sheetId: string;
  gid?: string;
  themeColor?: 'green' | 'blue' | 'purple' | 'yellow';
  onTrackingScan?: () => void;
  todayCount: number;
  goal?: number;
  onComplete?: () => void;
}

export default function StationTesting({
  userId,
  userName,
  sheetId,
  gid,
  themeColor = 'purple',
  onTrackingScan,
  todayCount = 0,
  goal = 50,
  onComplete,
}: StationTestingProps) {
  const safeGoal = Math.max(1, Number(goal) || 1);
  const goalProgressPercent = Math.min((todayCount / safeGoal) * 100, 100);
  const remainingToGoal = Math.max(safeGoal - todayCount, 0);

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    activeOrder,
    setActiveOrder,
    errorMessage,
    successMessage,
    trackingNotFoundAlert,
    resolvedManual,
    isManualLoading,
    handleSubmit,
    triggerGlobalRefresh,
    activeColor,
    clearFeedback,
  } = useStationTestingController({
    userId,
    onComplete,
    themeColor,
    onTrackingScan,
  });

  void sheetId;
  void gid;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden border-r border-gray-100">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 pb-2 space-y-4">
          <div className="space-y-0.5">
            <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
          </div>

          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between">
              <p className={`text-[9px] font-black ${activeColor.text} tabular-nums`}>{todayCount}/{safeGoal} SHIPPED</p>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{remainingToGoal} Left</p>
            </div>
            <div className="h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${goalProgressPercent}%` }}
                className={`h-full ${activeColor.bg} rounded-full shadow-sm`}
              />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative group">
            <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
              <Barcode className="w-4 h-4" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Scan Tracking, SKU, or SN..."
              className={`w-full pl-11 pr-14 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 outline-none transition-all shadow-inner`}
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isLoading ? (
                <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
              ) : (
                <div className="px-1.5 py-0.5 bg-white rounded border border-gray-100 shadow-sm">
                  <span className="text-[8px] font-black text-gray-400">ENTER</span>
                </div>
              )}
            </div>
          </form>

          <AnimatePresence>
            {trackingNotFoundAlert && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-2 p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-xs font-bold">{trackingNotFoundAlert}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-6 space-y-3">
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{errorMessage}</p>
              </motion.div>
            )}

            {successMessage && !errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-green-50 text-green-700 rounded-2xl border border-green-200 flex items-center gap-3"
              >
                <Check className="w-5 h-5 flex-shrink-0" />
                <p className="text-xs font-bold">{successMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {activeOrder ? (
              <ActiveStationOrderCard
                activeOrder={activeOrder}
                activeColorTextClass={activeColor.text}
                resolvedManual={resolvedManual}
                isManualLoading={isManualLoading}
              />
            ) : null}
          </AnimatePresence>

          <div className="space-y-3 mt-8">
            <UpNextOrder
              techId={userId}
              onStart={(tracking) => {
                setActiveOrder(null);
                clearFeedback();
                setTimeout(() => handleSubmit(undefined, tracking), 50);
              }}
              onMissingParts={() => {
                triggerGlobalRefresh();
              }}
            />
          </div>

          <div className="mt-auto pt-6 border-t border-gray-50 text-center">
            <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
          </div>
        </div>
      </div>
    </div>
  );
}
