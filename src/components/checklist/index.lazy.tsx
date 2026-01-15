'use client';

/**
 * Lazy-loaded checklist components for code splitting
 */

import dynamic from 'next/dynamic';

export const CompletedTasksLazy = dynamic(() => 
    import('./CompletedTasks').then(mod => ({ default: mod.CompletedTasks })),
    {
        loading: () => (
            <div className="flex items-center justify-center p-4">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
        ),
    }
);

export const TaskEditorLazy = dynamic(() => 
    import('./TaskEditor').then(mod => ({ default: mod.TaskEditor })),
    {
        loading: () => (
            <div className="space-y-3 bg-gray-50 p-4 rounded-2xl border border-blue-200 animate-pulse">
                <div className="h-10 bg-gray-200 rounded-xl" />
                <div className="h-20 bg-gray-200 rounded-xl" />
                <div className="h-10 bg-gray-200 rounded-xl" />
            </div>
        ),
    }
);
