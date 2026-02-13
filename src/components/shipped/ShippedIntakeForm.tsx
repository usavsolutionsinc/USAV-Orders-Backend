'use client';

import React, { useState } from 'react';
import { X, Loader2, Lock, Check, AlertCircle } from '../Icons';
import { TabSwitch } from '../ui/TabSwitch';

interface ShippedIntakeFormProps {
    onClose: () => void;
    onSubmit: (data: ShippedFormData) => void;
}

interface ReplacementShippedFormData {
    mode: 'replacement';
    order_id: string;
    product_title: string;
    reason: string;
    condition: string;
    shipping_tracking_number: string;
    sku: string;
}

interface AddOrderShippedFormData {
    mode: 'add_order';
    order_id: string;
    shipping_tracking_number: string;
    product_title: string;
    condition: string;
    sku: string;
}

export type ShippedFormData = ReplacementShippedFormData | AddOrderShippedFormData;

type LookupStatus = 'idle' | 'searching' | 'found' | 'not-found';

export function ShippedIntakeForm({ onClose, onSubmit }: ShippedIntakeFormProps) {
    const [activeTab, setActiveTab] = useState<'replacement' | 'add_order'>('replacement');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [lookupStatus, setLookupStatus] = useState<LookupStatus>('idle');

    const [replacementData, setReplacementData] = useState<ReplacementShippedFormData>({
        mode: 'replacement',
        order_id: '',
        product_title: '',
        reason: '',
        condition: 'Used',
        shipping_tracking_number: '',
        sku: '',
    });

    const [addOrderData, setAddOrderData] = useState<AddOrderShippedFormData>({
        mode: 'add_order',
        order_id: '',
        shipping_tracking_number: '',
        product_title: '',
        condition: 'Used',
        sku: '',
    });

    const [isProductTitleLocked, setIsProductTitleLocked] = useState(false);

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
                setReplacementData((prev) => ({ ...prev, product_title: data.product_title }));
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
        setReplacementData((prev) => ({ ...prev, order_id: value }));

        if (!value.trim()) {
            setReplacementData((prev) => ({ ...prev, product_title: '' }));
            setIsProductTitleLocked(false);
            setLookupStatus('idle');
        }
    };

    const handleOrderIdBlur = () => {
        if (replacementData.order_id.trim()) {
            lookupOrder(replacementData.order_id.trim());
        }
    };

    const canSubmitReplacement =
        replacementData.order_id.trim() &&
        replacementData.reason.trim() &&
        replacementData.product_title.trim() &&
        replacementData.condition.trim() &&
        replacementData.shipping_tracking_number.trim();

    const canSubmitAddOrder =
        addOrderData.order_id.trim() &&
        addOrderData.shipping_tracking_number.trim() &&
        addOrderData.product_title.trim() &&
        addOrderData.condition.trim();

    const handleSubmit = async () => {
        const submitData: ShippedFormData = activeTab === 'replacement' ? replacementData : addOrderData;
        const canSubmit = activeTab === 'replacement' ? canSubmitReplacement : canSubmitAddOrder;
        if (!canSubmit) return;

        setIsSubmitting(true);
        try {
            await onSubmit(submitData);
        } catch (error) {
            console.error('Error submitting form:', error);
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
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
                            New Order Entry
                        </h2>
                        <p className="text-[8px] font-bold text-green-600 uppercase tracking-widest">
                            Order Information
                        </p>
                    </div>
                </div>
            </div>

            <div className="px-4 pt-4 bg-white border-b border-gray-100">
                <TabSwitch
                    tabs={[
                        { id: 'replacement', label: 'Replacement', color: 'blue' },
                        { id: 'add_order', label: 'Add Order', color: 'emerald' },
                    ]}
                    activeTab={activeTab}
                    onTabChange={(tab) => setActiveTab(tab as 'replacement' | 'add_order')}
                />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-white">
                {activeTab === 'replacement' ? (
                    <>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Order ID <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={replacementData.order_id}
                                onChange={(e) => handleOrderIdChange(e.target.value)}
                                onBlur={handleOrderIdBlur}
                                placeholder="Enter order ID..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />

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

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Shipping Tracking Number <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={replacementData.shipping_tracking_number}
                                onChange={(e) => setReplacementData((prev) => ({ ...prev, shipping_tracking_number: e.target.value }))}
                                placeholder="Enter tracking number..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Reason or Ticket # <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={replacementData.reason}
                                onChange={(e) => setReplacementData((prev) => ({ ...prev, reason: e.target.value }))}
                                placeholder="Reason for shipment..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                            <p className="text-[9px] text-gray-500 font-medium">
                                Will be saved as: <span className="font-bold">{replacementData.reason || '[Reason]'} - {replacementData.product_title || '[Product Title]'}</span>
                            </p>
                        </div>

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
                                value={replacementData.product_title}
                                onChange={(e) => setReplacementData((prev) => ({ ...prev, product_title: e.target.value }))}
                                placeholder={isProductTitleLocked ? 'Auto-filled from order lookup' : 'Enter product title...'}
                                readOnly={isProductTitleLocked}
                                disabled={isProductTitleLocked}
                                className={`w-full px-4 py-3 border rounded-xl text-sm font-semibold transition-all ${
                                    isProductTitleLocked
                                        ? 'bg-green-50 border-green-300 text-green-900 cursor-not-allowed focus:outline-none'
                                        : 'bg-gray-50 border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
                                }`}
                            />
                            {isProductTitleLocked && (
                                <p className="text-[9px] text-green-600 font-medium">
                                    This field is locked because the order ID was found in the database.
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Condition <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={replacementData.condition}
                                onChange={(e) => setReplacementData((prev) => ({ ...prev, condition: e.target.value }))}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            >
                                <option value="Used">Used</option>
                                <option value="New">New</option>
                                <option value="Parts">Parts</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                SKU <span className="text-gray-400">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={replacementData.sku}
                                onChange={(e) => setReplacementData((prev) => ({ ...prev, sku: e.target.value }))}
                                placeholder="Enter SKU..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Order ID <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={addOrderData.order_id}
                                onChange={(e) => setAddOrderData((prev) => ({ ...prev, order_id: e.target.value }))}
                                placeholder="Enter order ID..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Shipping Tracking Number <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={addOrderData.shipping_tracking_number}
                                onChange={(e) => setAddOrderData((prev) => ({ ...prev, shipping_tracking_number: e.target.value }))}
                                placeholder="Enter tracking number..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Product Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={addOrderData.product_title}
                                onChange={(e) => setAddOrderData((prev) => ({ ...prev, product_title: e.target.value }))}
                                placeholder="Enter product title..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                Condition <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={addOrderData.condition}
                                onChange={(e) => setAddOrderData((prev) => ({ ...prev, condition: e.target.value }))}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            >
                                <option value="Used">Used</option>
                                <option value="New">New</option>
                                <option value="Parts">Parts</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-700">
                                SKU <span className="text-gray-400">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={addOrderData.sku}
                                onChange={(e) => setAddOrderData((prev) => ({ ...prev, sku: e.target.value }))}
                                placeholder="Enter SKU..."
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold font-mono focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-white">
                <button
                    onClick={handleSubmit}
                    disabled={(activeTab === 'replacement' ? !canSubmitReplacement : !canSubmitAddOrder) || isSubmitting}
                    className="w-full px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:bg-gray-300 disabled:text-white-500 text-white rounded-xl transition-all text-xs font-black uppercase tracking-wide disabled:cursor-not-allowed shadow-lg shadow-green-500/20"
                >
                    {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Submitting...
                        </span>
                    ) : activeTab === 'replacement' ? (
                        'Submit Order'
                    ) : (
                        'Add Order'
                    )}
                </button>
            </div>
        </div>
    );
}
