'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AblyProvider } from '@/contexts/AblyContext';

export default function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 3 * 60 * 1000,  // 3 min — safe; server-side tag invalidation fires on mutations
                gcTime: 5 * 60 * 1000,     // 5 min (default) — was 30 min, causing massive memory retention
                retry: 1,                  // one retry is enough; 2 doubles perceived lag on errors
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,  // don't blast the API on every network blip
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

