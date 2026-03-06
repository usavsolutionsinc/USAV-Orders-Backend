'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AblyProvider } from '@/contexts/AblyContext';

export default function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 5 * 60 * 1000, // 5 minutes — safe since server-side tag invalidation fires on mutations
                gcTime: 10 * 60 * 1000,   // keep unused cache for 10 minutes
                retry: 2,
                refetchOnWindowFocus: false,
            },
        },
    }));

    return (
        <QueryClientProvider client={queryClient}>
            <AblyProvider>
                {children}
                <Toaster position="top-right" richColors closeButton />
            </AblyProvider>
        </QueryClientProvider>
    );
}

