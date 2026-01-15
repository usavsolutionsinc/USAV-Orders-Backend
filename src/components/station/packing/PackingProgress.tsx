'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface PackingProgressProps {
    todayCount: number;
    goal: number;
}

/**
 * Progress display for packing station
 * Shows percentage, remaining items, and animated progress bar
 */
export function PackingProgress({ todayCount, goal }: PackingProgressProps) {
    const percentage = Math.min((todayCount / goal) * 100, 100);
    const remaining = Math.max(0, goal - todayCount);
    const isComplete = todayCount >= goal;

    return (
        <div className="px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-50">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                    {Math.round(percentage)}%
                </p>
                <p className="text-[10px] font-black text-gray-400 tabular-nums">
                    {remaining} remaining
                </p>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: `${percentage}%` }} 
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${
                        isComplete ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                />
            </div>
        </div>
    );
}
