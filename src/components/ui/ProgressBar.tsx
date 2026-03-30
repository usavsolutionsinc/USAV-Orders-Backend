'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

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
                        <p className={sectionLabel}>
                            {label}
                        </p>
                    )}
                    {showPercentage && (
                        <p className={sectionLabel}>
                            {Math.round(percentage)}%
                        </p>
                    )}
                    {showRemaining && (
                        <p className={`${sectionLabel} tabular-nums`}>
                            {remaining} remaining
                        </p>
                    )}
                </div>
            )}
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: `${percentage}%` }} 
                    transition={{ duration: 0.5, ease: motionBezier.easeOut }}
                    className={`h-full rounded-full ${barColor}`}
                />
            </div>
        </div>
    );
}
