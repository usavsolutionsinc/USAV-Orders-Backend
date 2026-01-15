'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from '../../Icons';

interface PhotoCaptureProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    canvasRef: React.RefObject<HTMLCanvasElement>;
    scannedTracking: string;
    photosCount: number;
    onTakePhoto: () => void;
    onFinish: () => void;
    onClose: () => void;
}

/**
 * Photo capture interface with camera controls
 * Includes shutter effect and photo count display
 */
export function PhotoCapture({ 
    videoRef, 
    canvasRef,
    scannedTracking, 
    photosCount,
    onTakePhoto, 
    onFinish, 
    onClose 
}: PhotoCaptureProps) {
    const [showShutter, setShowShutter] = useState(false);

    const handleTakePhoto = () => {
        setShowShutter(true);
        setTimeout(() => setShowShutter(false), 200);
        onTakePhoto();
    };

    return (
        <motion.div 
            key="camera" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black z-[100] flex flex-col"
        >
            <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Shutter Effect */}
            <AnimatePresence>
                {showShutter && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.1 }}
                        className="absolute inset-0 bg-white z-[105] pointer-events-none"
                    />
                )}
            </AnimatePresence>
            
            {/* Top Bar */}
            <div className="absolute top-8 left-0 right-0 px-6 flex justify-between items-start z-[110]">
                <div className="flex flex-col gap-2">
                    <div className="px-3 py-1.5 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <p className="text-[9px] font-black uppercase tracking-widest text-white/80">
                            {scannedTracking.slice(-8)}
                        </p>
                    </div>
                    <div className="px-3 py-1.5 bg-blue-600 rounded-full text-[9px] font-black text-white shadow-lg">
                        {photosCount} PHOTOS
                    </div>
                </div>
                <button 
                    onClick={onClose}
                    className="p-3 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 active:scale-90"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-0 left-0 right-0 pb-safe z-[110]">
                <div className="px-6 pb-8 flex justify-between items-center">
                    {/* Left: Empty spacer for balance */}
                    <div className="w-16" />
                    
                    {/* Center: Photo Button */}
                    <button 
                        onClick={handleTakePhoto} 
                        className="w-20 h-20 bg-white rounded-full flex items-center justify-center active:scale-90 transition-all shadow-[0_0_50px_rgba(255,255,255,0.3)] border-4 border-white/20"
                    >
                        <div className="w-14 h-14 rounded-full border-4 border-gray-900 bg-white" />
                    </button>
                    
                    {/* Right: Finish Button */}
                    <button 
                        onClick={onFinish} 
                        className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-xl shadow-emerald-600/30 text-white"
                    >
                        <Check className="w-8 h-8" />
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
