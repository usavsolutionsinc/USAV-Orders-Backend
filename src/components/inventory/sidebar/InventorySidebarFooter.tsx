'use client';

import { useAuth } from '@/contexts/AuthContext';

export function InventorySidebarFooter() {
    const { user } = useAuth();
    return (
        <footer className="mt-auto pt-4 border-t border-gray-200 opacity-30 text-center">
            <p className="text-eyebrow font-mono uppercase tracking-[0.2em] text-gray-500">
                {(user?.organizationName || 'Workspace').toUpperCase()} INVENTORY
            </p>
        </footer>
    );
}
