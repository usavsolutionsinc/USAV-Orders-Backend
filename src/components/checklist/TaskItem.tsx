'use client';

import React from 'react';
import { Check, Edit, Trash2 } from '../Icons';
import type { ChecklistItem } from '../../queries/useChecklistQueries';

interface TaskItemProps {
    task: ChecklistItem;
    onToggle: (taskId: number, nextStatus: string) => void;
    onEdit: (task: ChecklistItem) => void;
    onDelete: (taskId: number) => void;
    formatDuration: (minutes: number) => string;
}

/**
 * Individual checklist task item with status toggle
 */
export function TaskItem({ task, onToggle, onEdit, onDelete, formatDuration }: TaskItemProps) {
    const status = task.instance?.status || 'pending';
    const isCompleted = status === 'completed';
    const isInProgress = status === 'in_progress';

    const handleToggle = () => {
        const nextStatus = status === 'pending' ? 'in_progress' : status === 'in_progress' ? 'completed' : 'pending';
        onToggle(task.id, nextStatus);
    };

    return (
        <div
            className={`group relative p-4 rounded-2xl border transition-all ${
                isCompleted ? 'bg-emerald-50 border-emerald-100 opacity-60' :
                isInProgress ? 'bg-blue-50 border-blue-100 ring-1 ring-blue-50' :
                'bg-white border-gray-100 hover:border-gray-200 shadow-sm'
            }`}
        >
            <div className="flex gap-3">
                <button
                    onClick={handleToggle}
                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                        isCompleted ? 'bg-emerald-500 border-emerald-500' :
                        isInProgress ? 'bg-blue-500 border-blue-500' :
                        'border-gray-200 hover:border-blue-400'
                    }`}
                    title={status === 'pending' ? 'Start task' : status === 'in_progress' ? 'Complete task' : 'Reopen task'}
                >
                    {isCompleted && <Check className="w-3 h-3 text-white" />}
                    {isInProgress && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
                </button>

                <div className="flex-1 min-w-0">
                    <div className={`text-[11px] font-black tracking-tight ${isCompleted ? 'line-through text-emerald-600/50' : 'text-gray-900'}`}>
                        {task.title}
                    </div>
                    {task.description && (
                        <div className={`text-[9px] mt-1 leading-snug ${isCompleted ? 'line-through text-gray-400' : 'text-gray-500'}`}>
                            {task.description}
                        </div>
                    )}
                    
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {task.order_number && (
                            <div className="px-1.5 py-0.5 bg-gray-100 rounded text-[8px] font-mono text-gray-500 border border-gray-200">
                                O: {task.order_number}
                            </div>
                        )}
                        {task.tracking_number && (
                            <div className="px-1.5 py-0.5 bg-gray-100 rounded text-[8px] font-mono text-gray-500 border border-gray-200">
                                T: {task.tracking_number}
                            </div>
                        )}
                    </div>

                    {task.instance && (
                        <div className="mt-2 flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest">
                            {isInProgress && <span className="text-blue-600 animate-pulse">● Running</span>}
                            {isCompleted && (
                                <span className="text-emerald-600">
                                    ✓ Done {task.instance.duration_minutes ? `(${formatDuration(task.instance.duration_minutes)})` : ''}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {!isCompleted && (
                        <button 
                            onClick={() => onEdit(task)}
                            className="p-1 text-gray-400 hover:text-blue-500 transition-all"
                        >
                            <Edit className="w-3 h-3" />
                        </button>
                    )}
                    <button 
                        onClick={() => onDelete(task.id)} 
                        className="p-1 text-gray-400 hover:text-red-500 transition-all"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}
