'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from '../Icons';
import { ProductSelector } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm } from './CustomerInfoForm';

interface RepairIntakeFormProps {
    onClose: () => void;
    onSubmit: (data: RepairFormData) => void;
    initialData?: Partial<RepairFormData>;
}

export interface RepairFormData {
    product: {
        type: string;
        model: string;
        sourceSku?: string | null;
    };
    repairReasons: string[];
    repairNotes: string;
    customer: {
        name: string;
        phone: string;
        email: string;
    };
    serialNumber: string;
    price: string;
    notes: string;
    assignedTechId: number | null;
    assignedTechName: string;
}

interface TechStaff {
    id: number;
    name: string;
}

type FormStep = 'product' | 'customer';

function buildInitialFormData(initialData?: Partial<RepairFormData>): RepairFormData {
    return {
        product: {
            type: initialData?.product?.type || '',
            model: initialData?.product?.model || '',
            sourceSku: initialData?.product?.sourceSku ?? null,
        },
        repairReasons: Array.isArray(initialData?.repairReasons) ? initialData!.repairReasons : [],
        repairNotes: initialData?.repairNotes || '',
        customer: {
            name: initialData?.customer?.name || '',
            phone: initialData?.customer?.phone || '',
            email: initialData?.customer?.email || '',
        },
        serialNumber: initialData?.serialNumber || '',
        price: initialData?.price || '130',
        notes: initialData?.notes || '',
        assignedTechId: initialData?.assignedTechId ?? null,
        assignedTechName: initialData?.assignedTechName || '',
    };
}

export function RepairIntakeForm({ onClose, onSubmit, initialData }: RepairIntakeFormProps) {
    const [currentStep, setCurrentStep] = useState<FormStep>('product');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const reasonRef = useRef<HTMLDivElement>(null);

    const [formData, setFormData] = useState<RepairFormData>(() => buildInitialFormData(initialData));

    const [techs, setTechs] = useState<TechStaff[]>([]);
    const [loadingTechs, setLoadingTechs] = useState(true);

    useEffect(() => {
        fetch('/api/staff?role=technician&active=true')
            .then(r => r.json())
            .then((data: TechStaff[]) => setTechs(Array.isArray(data) ? data : []))
            .catch(() => setTechs([]))
            .finally(() => setLoadingTechs(false));
    }, []);

    useEffect(() => {
        setFormData(buildInitialFormData(initialData));
    }, [initialData]);

    const productSelected = !!(formData.product.type && formData.product.model);

    // Scroll reason section into view when it appears
    useEffect(() => {
        if (productSelected && reasonRef.current) {
            setTimeout(() => {
                reasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 120);
        }
    }, [productSelected]);

    const canProceedFromProduct =
        productSelected &&
        (formData.repairReasons.length > 0 || formData.repairNotes.trim().length > 0);

    const canSubmit =
        formData.customer.name && formData.customer.phone && formData.serialNumber && formData.price;

    const handleNext = () => {
        if (currentStep === 'product' && canProceedFromProduct) {
            setCurrentStep('customer');
        }
    };

    const handleBack = () => {
        if (currentStep === 'customer') setCurrentStep('product');
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
        setFormData(prev => ({ ...prev, customer: { ...prev.customer, [field]: value } }));
    };

    const stepLabel = currentStep === 'product' ? '1' : '2';

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
                            Step {stepLabel} of 2
                        </p>
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex gap-2">
                    <div className="flex-1 h-1 rounded-full bg-blue-500" />
                    <div className={`flex-1 h-1 rounded-full ${currentStep === 'customer' ? 'bg-blue-500' : 'bg-gray-200'}`} />
                </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-0 scrollbar-hide bg-white">

                {/* ── STEP 1: Product → Reason → Tech ── */}
                {currentStep === 'product' && (
                    <div className="space-y-6">
                        {/* Product Selector */}
                        <ProductSelector
                            onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                            selectedProduct={formData.product.type ? formData.product : null}
                            onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                        />

                        {/* Reason for Repair — slides in after product selected */}
                        <div
                            ref={reasonRef}
                            className={`transition-all duration-300 origin-top ${
                                productSelected
                                    ? 'opacity-100 translate-y-0 pointer-events-auto'
                                    : 'opacity-0 -translate-y-2 pointer-events-none h-0 overflow-hidden'
                            }`}
                        >
                            {productSelected && (
                                <div className="space-y-5 pt-2 border-t-2 border-dashed border-blue-200">
                                    <div className="pt-4">
                                        <ReasonSelector
                                            selectedReasons={formData.repairReasons}
                                            notes={formData.repairNotes}
                                            onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                                            onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                                        />
                                    </div>

                                    {/* Tech Assignment */}
                                    <div className="space-y-2">
                                        <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                                            Assign Technician <span className="text-gray-400 font-normal">(Optional)</span>
                                        </label>
                                        <select
                                            value={formData.assignedTechId ?? ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (!val) {
                                                    setFormData(prev => ({ ...prev, assignedTechId: null, assignedTechName: '' }));
                                                    return;
                                                }
                                                const tech = techs.find(t => t.id === Number(val));
                                                setFormData(prev => ({
                                                    ...prev,
                                                    assignedTechId: Number(val),
                                                    assignedTechName: tech?.name ?? '',
                                                }));
                                            }}
                                            disabled={loadingTechs}
                                            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                                        >
                                            <option value="">— Unassigned —</option>
                                            {techs.map(tech => (
                                                <option key={tech.id} value={tech.id}>{tech.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── STEP 2: Customer Info ── */}
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
                    {currentStep === 'customer' && (
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-2 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-xl transition-all text-xs font-bold uppercase tracking-wide"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </button>
                    )}

                    {currentStep === 'product' ? (
                        <div className="flex-1 flex gap-3">
                            {/* Add More — scrolls back to top of product grid */}
                            {productSelected && (
                                <button
                                    onClick={() => {
                                        const scrollEl = document.querySelector('.scrollbar-hide');
                                        scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all text-xs font-bold uppercase tracking-wide"
                                >
                                    + Add More
                                </button>
                            )}
                            <button
                                onClick={handleNext}
                                disabled={!canProceedFromProduct}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed"
                            >
                                Continue
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
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
