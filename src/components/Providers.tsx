'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AblyProvider } from '@/contexts/AblyContext';
import { PhonePairProvider } from '@/contexts/PhonePairContext';
import { MobilePairProvider } from '@/contexts/MobilePairContext';
import { SiteTooltipProvider } from '@/components/providers/SiteTooltipProvider';
import { UIModeProvider } from '@/design-system/providers/UIModeProvider';

export default function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 3 * 60 * 1000,  // 3 min — safe; server-side tag invalidation fires on mutations
                gcTime: 5 * 60 * 1000,     // 5 min (default) — was 30 min, causing massive memory retention
                retry: 1,                  // one retry is enough; 2 doubles perceived lag on errors
                refetchOnWindowFocus: 'always',  // refetch stale data when user returns to the tab
                refetchOnReconnect: 'always', // refetch after network recovery (laptop wake, etc.)
            },
        },
    }));

    return (
        <QueryClientProvider client={queryClient}>
            <AblyProvider>
                <UIModeProvider>
                    <PhonePairProvider>
                        <MobilePairProvider>
                            <SiteTooltipProvider>
                                {children}
                            </SiteTooltipProvider>
                        </MobilePairProvider>
                    </PhonePairProvider>
                </UIModeProvider>
                <Toaster position="bottom-right" richColors closeButton />
            </AblyProvider>
        </QueryClientProvider>
    );
}
