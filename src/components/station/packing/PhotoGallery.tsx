'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Camera as CameraIcon, ChevronLeft } from '../../Icons';

interface PhotoGalleryProps {
    photos: string[];
    orderId: string;
    onClose: () => void;
}

/**
 * Swipeable photo gallery component
 * Displays captured photos with order information
 */
export function PhotoGallery({ photos, orderId, onClose }: PhotoGalleryProps) {
    return (
        <motion.div 
            initial={{ opacity: 0, y: 100 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 100 }} 
            className="fixed inset-0 bg-black z-[200] flex flex-col"
        >
            <div className="flex-1 relative overflow-hidden flex items-center">
                {photos.length === 0 ? (
                    <div className="w-full text-center text-white/40">
                        <CameraIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="text-xs font-black uppercase tracking-widest">No Photos</p>
                    </div>
                ) : (
                    <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide w-full h-[70vh] px-6 gap-6">
                        {photos.map((photo, index) => (
                            <div
                                key={index}
                                className="min-w-full h-full snap-center relative"
                            >
                                <div className="w-full h-full bg-gray-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 relative">
                                    <img src={photo} alt="" className="w-full h-full object-cover" />
                                    <div className="absolute top-6 left-6 flex items-center gap-3">
                                        <div className="px-3 py-1 bg-black/50 backdrop-blur-md rounded-full border border-white/10">
                                            <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">
                                                {index + 1} of {photos.length}
                                            </p>
                                        </div>
                                        <div className="px-3 py-1 bg-blue-600/50 backdrop-blur-md rounded-full border border-blue-500/30">
                                            <p className="text-[10px] font-black text-white uppercase tracking-widest">
                                                {orderId}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Gallery Controls */}
            <div className="px-8 pb-12 flex justify-center items-center">
                <button 
                    onClick={onClose}
                    className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 active:scale-90 transition-all"
                >
                    <ChevronLeft className="w-10 h-10" />
                </button>
            </div>
        </motion.div>
    );
}
