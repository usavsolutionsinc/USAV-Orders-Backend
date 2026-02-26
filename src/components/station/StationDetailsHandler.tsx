'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShippedDetailsPanel } from '../shipped/ShippedDetailsPanel';
import { ShippedOrder } from '@/lib/neon/orders-queries';

/**
 * Component that listens for shipped details events and displays the details panel
 * Used in tech and packer station pages
 */
export function StationDetailsHandler({ viewMode = 'history' }: { viewMode?: 'history' | 'pending' }) {
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);

    // Listen for custom events to coordinate details panel
    useEffect(() => {
        const handleOpenDetails = (e: CustomEvent<ShippedOrder>) => {
            if (e.detail) {
                setSelectedShipped(e.detail);
            }
        };
        const handleCloseDetails = () => {
            setSelectedShipped(null);
        };

        window.addEventListener('open-shipped-details' as any, handleOpenDetails as any);
        window.addEventListener('close-shipped-details' as any, handleCloseDetails as any);
        
        return () => {
            window.removeEventListener('open-shipped-details' as any, handleOpenDetails as any);
            window.removeEventListener('close-shipped-details' as any, handleCloseDetails as any);
        };
    }, []);

    return (
        <AnimatePresence>
            {selectedShipped && (
                <ShippedDetailsPanel 
                    key="station-details-panel"
                    shipped={selectedShipped}
                    context={viewMode === 'pending' ? 'dashboard' : 'station'}
                    onClose={() => {
                        setSelectedShipped(null);
                        window.dispatchEvent(new CustomEvent('close-shipped-details'));
                    }}
                    onUpdate={() => {
                        // Optionally refresh data
                        setSelectedShipped(null);
                    }}
                />
            )}
        </AnimatePresence>
    );
}
