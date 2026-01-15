'use client';

import React from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from '../Icons';
import type { CompletedTask } from '../../queries/useChecklistQueries';

interface CompletedTasksProps {
    tasks: CompletedTask[];
    isOpen: boolean;
    onToggle: () => void;
    onRestore: (taskId: number) => void;
    formatDuration: (minutes: number) => string;
}

/**
 * Collapsible list of completed tasks with restore functionality
 */
export function CompletedTasks({ tasks, isOpen, onToggle, onRestore, formatDuration }: CompletedTasksProps) {
    return (
        <div className="border-t border-gray-100">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    Completed {tasks.length > 0 ? `(${tasks.length})` : ''}
                </span>
                {isOpen ? (
                    <ChevronUp className="w-3 h-3 text-gray-400" />
                ) : (
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                )}
            </button>
            
            {isOpen && (
                <div className="max-h-60 overflow-y-auto p-4 space-y-2 bg-gray-50 scrollbar-hide">
                    {tasks.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <p className="text-[10px] font-bold uppercase tracking-widest">No completed tasks yet</p>
                        </div>
                    ) : (
                        tasks.map((task) => (
                            <div
                                key={task.id}
                                className="p-3 bg-white rounded-xl border border-gray-100 group hover:border-gray-200 transition-all"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] font-bold text-gray-600 line-through">
                                            {task.task_title}
                                        </div>
                                        {task.task_description && (
                                            <div className="text-[9px] text-gray-400 mt-0.5 line-through">
                                                {task.task_description}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 mt-1.5">
                                            <span className="text-[8px] text-emerald-600 font-bold">
                                                ✓ {new Date(task.completed_at).toLocaleDateString()} {new Date(task.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {task.duration_minutes && (
                                                <span className="text-[8px] text-gray-400">
                                                    ({formatDuration(task.duration_minutes)})
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            {task.order_number && (
                                                <div className="px-1.5 py-0.5 bg-gray-50 rounded text-[8px] font-mono text-gray-400 border border-gray-100">
                                                    O: {task.order_number}
                                                </div>
                                            )}
                                            {task.tracking_number && (
                                                <div className="px-1.5 py-0.5 bg-gray-50 rounded text-[8px] font-mono text-gray-400 border border-gray-100">
                                                    T: {task.tracking_number}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => onRestore(task.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                                        title="Restore task"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
