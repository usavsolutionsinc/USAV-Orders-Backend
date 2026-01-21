'use client';

import React, { useState } from 'react';
import { X, Loader2, Lock, Check, AlertCircle } from '../Icons';

interface ShippedIntakeFormProps {
    onClose: () => void;
    onSubmit: (data: ShippedFormData) => void;
}

export interface ShippedFormData {
    order_id: string;
    product_title: string;
    reason: string;
    shipping_tracking_number: string;
    sku: string;
}

type LookupStatus = 'idle' | 'searching' | 'found' | 'not-found';

export function ShippedIntakeForm({ onClose, onSubmit }: ShippedIntakeFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [lookupStatus, setLookupStatus] = useState<LookupStatus>('idle');
    
    const [formData, setFormData] = useState<ShippedFormData>({
        order_id: '',
        product_title: '',
        reason: '',
        shipping_tracking_number: '',
        sku: '',
    });

    const [isProductTitleLocked, setIsProductTitleLocked] = useState(false);

    // Lookup order by order_id
    const lookupOrder = async (orderId: string) => {
        if (!orderId.trim()) {
            setLookupStatus('idle');
            setIsProductTitleLocked(false);
            return;
        }

        setLookupStatus('searching');
        try {
            const res = await fetch(`/api/shipped/lookup-order?order_id=${encodeURIComponent(orderId)}`);
            const data = await res.json();

            if (res.ok && data.found) {
                setFormData(prev => ({ ...prev, product_title: data.product_title }));
                setIsProductTitleLocked(true);
                setLookupStatus('found');
            } else {
                setIsProductTitleLocked(false);
                setLookupStatus('not-found');
            }
        } catch (error) {
            console.error('Error looking up order:', error);
            setIsProductTitleLocked(false);
            setLookupStatus('not-found');
        }
    };

    const handleOrderIdChange = (value: string) => {
        setFormData(prev => ({ ...prev, order_id: value }));
        
        // Reset product title if order ID is cleared
        if (!value.trim()) {
            setFormData(prev => ({ ...prev, product_title: '' }));
            setIsProductTitleLocked(false);
            setLookupStatus('idle');
        }
    };

    const handleOrderIdBlur = () => {
        if (formData.order_id.trim()) {
            lookupOrder(formData.order_id.trim());
        }
    };

    const canSubmit = 
        formData.order_id.trim() &&
        formData.product_title.trim() &&
        formData.reason.trim() &&
        formData.shipping_tracking_number.trim() &&
        formData.sku.trim();

    const handleSubmit = async () => {
        if (!canSubmit) return;
        
        setIsSubmitting(true);
        try {
            await onSubmit(formData);
        } catch (error) {
            console.error('Error submitting form:', error);
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
                    >
                        <X className="w-4 h-4 text-gray-600" />
                    </button>
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">
                            New Shipped Entry
                        </h2>
                        <p className="text-[8px] font-bold text-green-600 uppercase tracking-widest">
                            Shipment Information
                        </p>
                    </div>
                </div>
            </div>

            {/* Form Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-white">
                {/* Order ID */}
                <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                        Order ID <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.order_id}
                        onChange={(e) => handleOrderIdChange(e.target.value)}
                        onBlur={handleOrderIdBlur}
                        placeholder="Enter order ID..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    />
                    
                    {/* Lookup Status Indicator */}
                    {lookupStatus !== 'idle' && (
                        <div className="flex items-center gap-2 text-xs">
                            {lookupStatus === 'searching' && (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                    <span className="text-blue-600 font-bold">Searching...</span>
                                </>
                            )}
                            {lookupStatus === 'found' && (
                                <>
                                    <Check className="w-3 h-3 text-green-600" />
                                    <span className="text-green-600 font-bold">Order found! Product title auto-filled.</span>
                                </>
                            )}
                            {lookupStatus === 'not-found' && (
                                <>
                                    <AlertCircle className="w-3 h-3 text-amber-600" />
                                    <span className="text-amber-600 font-bold">Order not found. Please enter product title manually.</span>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Product Title */}
                <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                        Product Title <span className="text-red-500">*</span>
                        {isProductTitleLocked && (
                            <span className="ml-2 inline-flex items-center gap-1 text-green-600">
                                <Lock className="w-3 h-3" />
                                <span className="text-[8px]">Locked</span>
                            </span>
                        )}
                    </label>
                    <input
                        type="text"
                        value={formData.product_title}
                        onChange={(e) => !isProductTitleLocked && setFormData(prev => ({ ...prev, product_title: e.target.value }))}
                        placeholder={isProductTitleLocked ? "Auto-filled from order lookup" : "Enter product title..."}
                        disabled={isProductTitleLocked}
                        className={`w-full px-4 py-3 border rounded-xl text-sm font-semibold focus:outline-none transition-all ${
                            isProductTitleLocked
                                ? 'bg-green-50 border-green-300 text-green-900 cursor-not-allowed'
                                : 'bg-gray-50 border-gray-200 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                        }`}
                    />
                    {isProductTitleLocked && (
                        <p className="text-[9px] text-green-600 font-medium">
                            This field is locked because the order ID was found in the database.
                        </p>
                    )}
                </div>

                {/* Reason */}
                <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                        Reason <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.reason}
                        onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                        placeholder="Reason for shipment..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    />
                    <p className="text-[9px] text-gray-500 font-medium">
                        Will be appended as: <span className="font-bold">{formData.product_title || '[Product Title]'} - {formData.reason || '[Reason]'}</span>
                    </p>
                </div>

                {/* Shipping Tracking Number */}
                <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                        Shipping Tracking Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.shipping_tracking_number}
                        onChange={(e) => setFormData(prev => ({ ...prev, shipping_tracking_number: e.target.value }))}
                        placeholder="Enter tracking number..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    />
                </div>

                {/* SKU */}
                <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                        SKU <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.sku}
                        onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                        placeholder="Enter SKU..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    />
                </div>
            </div>

            {/* Footer Submit Button */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || isSubmitting}
                    className="w-full px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-xs font-black uppercase tracking-wide disabled:cursor-not-allowed shadow-lg shadow-green-500/20"
                >
                    {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Submitting...
                        </span>
                    ) : (
                        'Submit Shipment'
                    )}
                </button>
            </div>
        </div>
    );
}
