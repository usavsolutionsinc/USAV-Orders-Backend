'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X } from '../../Icons';

interface CameraScannerProps {
    isSearching: boolean;
    onClose: () => void;
}

/**
 * QR code scanner overlay component
 * Requires Html5Qrcode to be initialized externally with id="reader"
 */
export function CameraScanner({ isSearching, onClose }: CameraScannerProps) {
    return (
        <motion.div 
            key="scanner" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black z-[100] flex flex-col"
        >
            <div id="reader" className="absolute inset-0" />
            <div className="absolute inset-0 border-4 border-blue-500/30 m-20 rounded-3xl animate-pulse pointer-events-none" />
            <div className="absolute top-10 left-0 right-0 p-8 flex justify-between items-center z-[110]">
                <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                    <p className="text-xs font-black uppercase tracking-widest text-white/80">
                        {isSearching ? 'Searching...' : 'Scanning...'}
                    </p>
                </div>
                <button 
                    onClick={onClose} 
                    className="p-4 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 active:scale-90"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>
        </motion.div>
    );
}
