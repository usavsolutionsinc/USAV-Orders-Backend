import { useState, useCallback, useRef, useEffect } from 'react';

export interface InfiniteScrollOptions<T> {
    initialData?: T[];
    limit?: number;
    fetchMore: (offset: number, limit: number) => Promise<T[]>;
}

export interface InfiniteScrollResult<T> {
    data: T[];
    isLoading: boolean;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    reset: () => void;
    scrollRef: React.RefObject<HTMLDivElement>;
}

/**
 * Hook to manage infinite scroll with automatic loading
 * @param options - Configuration options
 * @returns Infinite scroll state and controls
 */
export function useInfiniteScroll<T>({
    initialData = [],
    limit = 50,
    fetchMore,
}: InfiniteScrollOptions<T>): InfiniteScrollResult<T> {
    const [data, setData] = useState<T[]>(initialData);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(initialData.length);
    const scrollRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const loadMore = useCallback(async () => {
        if (isLoading || !hasMore) return;

        setIsLoading(true);
        try {
            const newData = await fetchMore(offset, limit);
            
            if (newData.length < limit) {
                setHasMore(false);
            }

            setData(prev => [...prev, ...newData]);
            setOffset(prev => prev + newData.length);
        } catch (error) {
            console.error('Failed to load more:', error);
        } finally {
            setIsLoading(false);
        }
    }, [offset, limit, isLoading, hasMore, fetchMore]);

    const reset = useCallback(() => {
        setData(initialData);
        setOffset(initialData.length);
        setHasMore(true);
        setIsLoading(false);
    }, [initialData]);

    // Set up intersection observer for automatic loading
    useEffect(() => {
        if (!scrollRef.current) return;

        observerRef.current = new IntersectionObserver(
            (entries) => {
                const first = entries[0];
                if (first.isIntersecting && hasMore && !isLoading) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [hasMore, isLoading, loadMore]);

    // Update data when initialData changes
    useEffect(() => {
        setData(initialData);
        setOffset(initialData.length);
    }, [initialData]);

    return {
        data,
        isLoading,
        hasMore,
        loadMore,
        reset,
        scrollRef,
    };
}
