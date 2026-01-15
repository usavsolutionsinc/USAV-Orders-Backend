'use client';

import React from 'react';
import { Search, Camera as CameraIcon, Check, X } from '../../Icons';

interface OrderDetailsProps {
    orderDetails: any;
    photos: string[];
    onAddPhoto: () => void;
    onNewScan: () => void;
    onViewPhotos: () => void;
}

const mockDetails = {
    orderId: 'ORD-7721',
    boxSize: '12x12x12',
    instructions: 'Fragile. Wrap in double bubble wrap. Use heavy duty tape.',
    productTitle: 'Sony Alpha a7 IV Mirrorless Camera',
};

/**
 * Order details display with instructions and actions
 */
export function OrderDetails({ 
    orderDetails, 
    photos, 
    onAddPhoto, 
    onNewScan,
    onViewPhotos 
}: OrderDetailsProps) {
    return (
        <div className="space-y-4 pb-20">
            {/* Order ID and Box Size (Same Row) */}
            <div className="flex items-baseline justify-between gap-4">
                <h1 className="text-2xl font-black text-blue-600 tracking-tight">
                    {orderDetails?.orderId || mockDetails.orderId}
                </h1>
                <p className="text-xl font-black text-gray-900 tracking-tight">
                    {mockDetails.boxSize}
                </p>
            </div>

            <p className="text-sm font-black leading-tight text-gray-900 tracking-tight -mt-2">
                {orderDetails?.productTitle || mockDetails.productTitle}
            </p>

            {/* Frequently Missed Items Warning */}
            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
                <div className="flex items-center gap-2 text-amber-600 mb-2">
                    <X className="w-4 h-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Frequently Missed Items</p>
                </div>
                <ul className="text-xs font-bold text-amber-900 space-y-1 ml-6 list-disc">
                    <li>Power cables & adapters</li>
                    <li>Remote controls</li>
                    <li>Instruction manuals</li>
                    <li>Small mounting screws</li>
                </ul>
            </div>

            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                <div className="flex items-center gap-2 text-blue-500 mb-2">
                    <Check className="w-3 h-3" />
                    <p className="text-[9px] font-black uppercase tracking-widest">Instructions</p>
                </div>
                <p className="text-xs font-medium leading-relaxed text-blue-900">{mockDetails.instructions}</p>
            </div>

            {photos.length > 0 && (
                <button 
                    onClick={onViewPhotos}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group active:scale-[0.98] transition-all"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden border border-gray-200 bg-white">
                            <img src={photos[photos.length - 1]} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="text-left">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">View Photos</p>
                            <p className="text-sm font-black text-gray-900">{photos.length} captured</p>
                        </div>
                    </div>
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-gray-100 shadow-sm group-hover:border-blue-200 group-hover:text-blue-500 transition-all">
                        <CameraIcon className="w-5 h-5" />
                    </div>
                </button>
            )}

            <div className="flex justify-center items-center gap-3 pt-4">
                <button 
                    onClick={onAddPhoto} 
                    className="flex-1 h-14 bg-white border-2 border-gray-200 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                >
                    <CameraIcon className="w-4 h-4 text-gray-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Add Photo</span>
                </button>
                <button 
                    onClick={onNewScan} 
                    className="flex-1 h-14 bg-blue-600 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-200 text-white"
                >
                    <Search className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">New Scan</span>
                </button>
            </div>
        </div>
    );
}
