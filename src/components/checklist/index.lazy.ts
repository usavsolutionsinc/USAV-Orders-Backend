/**
 * Lazy-loaded checklist components for code splitting
 */

import dynamic from 'next/dynamic';
import { LoadingSpinner } from '../ui/LoadingSpinner';

export const CompletedTasksLazy = dynamic(() => 
    import('./CompletedTasks').then(mod => ({ default: mod.CompletedTasks })),
    {
        loading: () => <LoadingSpinner size="sm" className="mx-auto my-4" />,
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
