'use client';

import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from '../Icons';
import { ProductSelector } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm } from './CustomerInfoForm';

interface RepairIntakeFormProps {
    onClose: () => void;
    onSubmit: (data: RepairFormData) => void;
}

export interface RepairFormData {
    product: {
        type: string;
        model: string;
    };
    repairReasons: string[];
    repairNotes: string; // Step 2 - appends to issue
    customer: {
        name: string;
        phone: string;
        email: string;
    };
    serialNumber: string;
    price: string;
    notes: string; // Step 3 - goes to DB notes column
}

type FormStep = 'product' | 'reason' | 'customer';

export function RepairIntakeForm({ onClose, onSubmit }: RepairIntakeFormProps) {
    const [currentStep, setCurrentStep] = useState<FormStep>('product');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const [formData, setFormData] = useState<RepairFormData>({
        product: { type: '', model: '' },
        repairReasons: [],
        repairNotes: '',
        customer: { name: '', phone: '', email: '' },
        serialNumber: '',
        price: '130',
        notes: ''
    });

    const canProceedFromProduct = formData.product.type && (formData.product.type === 'Other' ? formData.product.model : formData.product.model);
    const canProceedFromReason = formData.repairReasons.length > 0 || formData.repairNotes.trim().length > 0;
    const canSubmit = formData.customer.name && formData.customer.phone && formData.serialNumber && formData.price;

    const handleNext = () => {
        if (currentStep === 'product' && canProceedFromProduct) {
            setCurrentStep('reason');
        } else if (currentStep === 'reason' && canProceedFromReason) {
            setCurrentStep('customer');
        }
    };

    const handleBack = () => {
        if (currentStep === 'customer') {
            setCurrentStep('reason');
        } else if (currentStep === 'reason') {
            setCurrentStep('product');
        }
    };

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

    const updateCustomer = (field: string, value: string) => {
        setFormData(prev => ({
            ...prev,
            customer: { ...prev.customer, [field]: value }
        }));
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
                            New Repair
                        </h2>
                        <p className="text-[8px] font-bold text-blue-600 uppercase tracking-widest">
                            Step {currentStep === 'product' ? '1' : currentStep === 'reason' ? '2' : '3'} of 3
                        </p>
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex gap-2">
                    <div className={`flex-1 h-1 rounded-full ${
                        currentStep === 'product' || currentStep === 'reason' || currentStep === 'customer' 
                            ? 'bg-blue-500' 
                            : 'bg-gray-200'
                    }`} />
                    <div className={`flex-1 h-1 rounded-full ${
                        currentStep === 'reason' || currentStep === 'customer' 
                            ? 'bg-blue-500' 
                            : 'bg-gray-200'
                    }`} />
                    <div className={`flex-1 h-1 rounded-full ${
                        currentStep === 'customer' 
                            ? 'bg-blue-500' 
                            : 'bg-gray-200'
                    }`} />
                </div>
            </div>

            {/* Form Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide bg-white">
                {currentStep === 'product' && (
                    <ProductSelector
                        onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                        selectedProduct={formData.product.type ? formData.product : null}
                    />
                )}

                {currentStep === 'reason' && (
                    <ReasonSelector
                        selectedReasons={formData.repairReasons}
                        notes={formData.repairNotes}
                        onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                        onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                    />
                )}

                {currentStep === 'customer' && (
                    <CustomerInfoForm
                        customer={formData.customer}
                        serialNumber={formData.serialNumber}
                        price={formData.price}
                        notes={formData.notes}
                        onCustomerChange={updateCustomer}
                        onSerialNumberChange={(value) => setFormData(prev => ({ ...prev, serialNumber: value }))}
                        onPriceChange={(value) => setFormData(prev => ({ ...prev, price: value }))}
                        onNotesChange={(value) => setFormData(prev => ({ ...prev, notes: value }))}
                    />
                )}
            </div>

            {/* Footer Navigation */}
            <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex gap-3">
                    {currentStep !== 'product' && (
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-2 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-xl transition-all text-xs font-bold uppercase tracking-wide"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </button>
                    )}

                    {currentStep !== 'customer' ? (
                        <button
                            onClick={handleNext}
                            disabled={
                                (currentStep === 'product' && !canProceedFromProduct) ||
                                (currentStep === 'reason' && !canProceedFromReason)
                            }
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed"
                        >
                            Continue
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={!canSubmit || isSubmitting}
                            className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Submitting...' : 'Submit & Print'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
