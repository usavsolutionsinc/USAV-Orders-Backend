'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface ProgressBarProps {
    current: number;
    goal: number;
    label?: string;
    showPercentage?: boolean;
    showRemaining?: boolean;
    variant?: 'default' | 'success';
    className?: string;
}

/**
 * Animated progress bar component for tracking goals
 */
export function ProgressBar({
    current,
    goal,
    label,
    showPercentage = true,
    showRemaining = true,
    variant = 'default',
    className = '',
}: ProgressBarProps) {
    const percentage = Math.min((current / goal) * 100, 100);
    const remaining = Math.max(0, goal - current);
    const isComplete = current >= goal;

    const barColor = variant === 'success' || isComplete ? 'bg-emerald-500' : 'bg-blue-500';

    return (
        <div className={`${className}`}>
            {(showPercentage || showRemaining || label) && (
                <div className="flex items-center justify-between mb-2">
                    {label && (
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                            {label}
                        </p>
                    )}
                    {showPercentage && (
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                            {Math.round(percentage)}%
                        </p>
                    )}
                    {showRemaining && (
                        <p className="text-[10px] font-black text-gray-400 tabular-nums">
                            {remaining} remaining
                        </p>
                    )}
                </div>
            )}
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: `${percentage}%` }} 
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${barColor}`}
                />
            </div>
        </div>
    );
}
