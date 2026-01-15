'use client';

import { useState } from 'react';
import { Plus } from './Icons';

// Import refactored sub-components
import { TaskItem } from './checklist/TaskItem';
import { TaskEditor, TaskFormData } from './checklist/TaskEditor';
import { CompletedTasks } from './checklist/CompletedTasks';

// Import React Query hooks
import { useChecklistQueries, ChecklistItem } from '@/queries/useChecklistQueries';

interface ChecklistProps {
    role: 'technician' | 'packer';
    userId?: string;
}

export default function Checklist({ role, userId = '1' }: ChecklistProps) {
    // Hardcoded staff ID logic - using userId as a proxy for station-specific staff
    const staffId = parseInt(userId);
    const staffName = `${role === 'technician' ? 'Tech' : 'Packer'} Station ${userId}`;
    
    // Create station_id from role and userId (e.g., "Tech_1", "Packer_2")
    const stationId = `${role === 'technician' ? 'Tech' : 'Packer'}_${userId}`;

    // State for UI
    const [editingTask, setEditingTask] = useState<ChecklistItem | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);

    // Use the refactored React Query hooks
    const {
        items,
        isLoading,
        completedTasks,
        toggleTask,
        restoreTask,
        updateTemplate,
        createTemplate,
        deleteTemplate,
        isToggling,
        isUpdating,
        isCreating,
        isDeleting,
    } = useChecklistQueries({
        role,
        stationId,
        staffId,
        staffName,
    });

    // Format duration helper
    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    // Handle task toggle
    const handleToggle = (taskId: number, nextStatus: string) => {
        toggleTask({ templateId: taskId, status: nextStatus });
        
        // Auto-show completed tasks when completing
        if (nextStatus === 'completed') {
            setTimeout(() => setShowCompleted(true), 500);
        }
    };

    // Handle task edit
    const handleEdit = (task: ChecklistItem) => {
        setEditingTask(task);
    };

    // Handle save (create or update)
    const handleSave = (data: TaskFormData) => {
        if (data.id) {
            // Update existing task
            updateTemplate(data);
            setEditingTask(null);
        } else {
            // Create new task
            createTemplate(data);
            setIsAdding(false);
        }
    };

    // Handle cancel
    const handleCancel = () => {
        setEditingTask(null);
        setIsAdding(false);
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="p-4 animate-pulse space-y-4">
                <div className="h-10 bg-gray-50 rounded-xl" />
                <div className="h-32 bg-gray-50 rounded-xl" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white text-gray-900">
            {/* NEW TASK FORM - AT TOP */}
            <div className="p-4 border-b border-gray-100">
                {isAdding || editingTask ? (
                    <TaskEditor
                        task={editingTask || undefined}
                        onSave={handleSave}
                        onCancel={handleCancel}
                        isLoading={isCreating || isUpdating}
                    />
                ) : (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="w-full py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-all flex items-center justify-center gap-2"
                    >
                        <Plus className="w-3 h-3" /> New Task
                    </button>
                )}
            </div>

            {/* TASK LIST */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {items.map((item) => (
                    <TaskItem
                        key={item.id}
                        task={item}
                        onToggle={handleToggle}
                        onEdit={handleEdit}
                        onDelete={deleteTemplate}
                        formatDuration={formatDuration}
                    />
                ))}

                {items.length === 0 && !isAdding && (
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-sm font-bold">No active tasks</p>
                        <p className="text-xs mt-1">Click "New Task" to get started</p>
                    </div>
                )}
            </div>

            {/* COMPLETED TASKS DROPDOWN */}
            <CompletedTasks
                tasks={completedTasks}
                isOpen={showCompleted}
                onToggle={() => setShowCompleted(!showCompleted)}
                onRestore={restoreTask}
                formatDuration={formatDuration}
            />

            <footer className="p-4 border-t border-gray-100 opacity-20 text-center">
                <p className="text-[7px] font-mono tracking-[0.2em] text-gray-900">USAV STATION</p>
            </footer>
        </div>
    );
}
