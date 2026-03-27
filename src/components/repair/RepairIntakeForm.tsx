'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from '../Icons';
import { ProductSelector } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { RepairAgreement } from './RepairAgreement';
import type { SignatureData } from './SignaturePad';

interface RepairIntakeFormProps {
    onClose: () => void;
    onSubmit: (data: RepairFormData) => void;
    initialData?: Partial<RepairFormData>;
    favoriteSkuId?: number | null;
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
    signatureDataUrl?: string | null;
    signatureStrokes?: unknown[] | null;
}

interface TechStaff {
    id: number;
    name: string;
}

type FormStep = 'product' | 'customer' | 'agreement';

const STEPS: { key: FormStep; label: string; shortLabel: string }[] = [
    { key: 'product', label: 'Product & Issue', shortLabel: 'Product' },
    { key: 'customer', label: 'Customer Info', shortLabel: 'Customer' },
    { key: 'agreement', label: 'Agreement', shortLabel: 'Sign' },
];

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
        signatureDataUrl: null,
        signatureStrokes: null,
    };
}

export function RepairIntakeForm({ onClose, onSubmit, initialData, favoriteSkuId }: RepairIntakeFormProps) {
    const [currentStep, setCurrentStep] = useState<FormStep>('product');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const reasonRef = useRef<HTMLDivElement>(null);

    const [formData, setFormData] = useState<RepairFormData>(() => buildInitialFormData(initialData));
    const [signatureData, setSignatureData] = useState<SignatureData | null>(null);

    const [techs, setTechs] = useState<TechStaff[]>([]);
    const [loadingTechs, setLoadingTechs] = useState(true);
    const [skuIssues, setSkuIssues] = useState<string[]>([]);

    useEffect(() => {
        fetch('/api/staff?role=technician&active=true')
            .then(r => r.json())
            .then((data: TechStaff[]) => setTechs(Array.isArray(data) ? data : []))
            .catch(() => setTechs([]))
            .finally(() => setLoadingTechs(false));
    }, []);

    useEffect(() => {
        const url = favoriteSkuId
            ? `/api/repair/issues?favoriteSkuId=${favoriteSkuId}`
            : '/api/repair/issues';
        fetch(url)
            .then(r => r.json())
            .then(data => setSkuIssues(
                Array.isArray(data?.issues) ? data.issues.map((i: { label: string }) => i.label) : [],
            ))
            .catch(() => setSkuIssues([]));
    }, [favoriteSkuId]);

    useEffect(() => {
        setFormData(buildInitialFormData(initialData));
    }, [initialData]);

    const productSelected = !!(formData.product.type && formData.product.model);

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

    const canProceedFromCustomer =
        !!(formData.customer.name && formData.customer.phone && formData.serialNumber && formData.price);

    const canSubmit = canProceedFromCustomer && !!signatureData;

    const handleNext = () => {
        if (currentStep === 'product' && canProceedFromProduct) {
            setCurrentStep('customer');
        } else if (currentStep === 'customer' && canProceedFromCustomer) {
            setCurrentStep('agreement');
        }
    };

    const handleBack = () => {
        if (currentStep === 'customer') setCurrentStep('product');
        else if (currentStep === 'agreement') setCurrentStep('customer');
    };

    const handleSubmit = async () => {
        if (!canSubmit || !signatureData) return;
        setIsSubmitting(true);
        try {
            await onSubmit({
                ...formData,
                signatureDataUrl: signatureData.dataUrl,
                signatureStrokes: signatureData.strokes,
            });
        } catch (error) {
            console.error('Error submitting form:', error);
            setIsSubmitting(false);
        }
    };

    const updateCustomer = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, customer: { ...prev.customer, [field]: value } }));
    };

    const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

    return (
        <div className="flex flex-col h-full bg-white">

            {/* ── Header ── */}
            <div className="flex-shrink-0 bg-white border-b-2 border-gray-900">
                <div className="flex items-stretch h-14">
                    {/* Close */}
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center w-14 border-r-2 border-gray-900 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-gray-900" />
                    </button>

                    {/* Title */}
                    <div className="flex-1 flex items-center px-4 gap-3">
                        <div>
                            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600">
                                Repair Intake
                            </p>
                            <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-none mt-0.5">
                                {STEPS[currentStepIndex].label}
                            </h2>
                        </div>
                    </div>

                    {/* Step counter */}
                    <div className="flex items-center px-4 border-l-2 border-gray-900">
                        <span className="text-xs font-black text-gray-400 tabular-nums">
                            {currentStepIndex + 1}
                            <span className="text-gray-300 mx-0.5">/</span>
                            {STEPS.length}
                        </span>
                    </div>
                </div>

                {/* ── Step Indicator Rail ── */}
                <div className="flex border-t border-gray-200">
                    {STEPS.map((step, i) => {
                        const isActive = step.key === currentStep;
                        const isDone = i < currentStepIndex;
                        return (
                            <div
                                key={step.key}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 border-r last:border-r-0 border-gray-200 ${
                                    isActive ? 'bg-blue-600' : isDone ? 'bg-gray-900' : 'bg-white'
                                }`}
                            >
                                {isDone ? (
                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : (
                                    <span className={`text-[9px] font-black tabular-nums ${isActive ? 'text-white' : 'text-gray-400'}`}>
                                        {i + 1}
                                    </span>
                                )}
                                <span className={`text-[9px] font-black uppercase tracking-wide ${
                                    isActive ? 'text-white' : isDone ? 'text-white' : 'text-gray-400'
                                }`}>
                                    {step.shortLabel}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Form Content ── */}
            <div className="flex-1 overflow-y-auto bg-gray-50 scrollbar-hide">
                <div className="p-5 space-y-0">

                    {/* ── STEP 1: Product → Reason → Tech ── */}
                    {currentStep === 'product' && (
                        <div className="space-y-6">
                            {/* Product Selector card */}
                            <div className="bg-white border-2 border-gray-900 p-5">
                                <ProductSelector
                                    onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                                    selectedProduct={formData.product.type ? formData.product : null}
                                    onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                                />
                            </div>

                            {/* Reason + Tech — slides in after product selected */}
                            <div
                                ref={reasonRef}
                                className={`transition-all duration-300 origin-top ${
                                    productSelected
                                        ? 'opacity-100 translate-y-0 pointer-events-auto'
                                        : 'opacity-0 -translate-y-2 pointer-events-none h-0 overflow-hidden'
                                }`}
                            >
                                {productSelected && (
                                    <div className="space-y-4">
                                        {/* Reason card */}
                                        <div className="bg-white border-2 border-gray-900 p-5">
                                            <ReasonSelector
                                                selectedReasons={formData.repairReasons}
                                                notes={formData.repairNotes}
                                                onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                                                onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                                                skuIssues={skuIssues}
                                            />
                                        </div>

                                        {/* Tech Assignment card */}
                                        <div className="bg-white border-2 border-gray-900 p-5 space-y-3">
                                            <div>
                                                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                                                    Assignment
                                                </p>
                                                <label className="block text-xs font-black uppercase tracking-tight text-gray-900">
                                                    Assign Technician
                                                    <span className="ml-2 text-[9px] font-bold text-gray-400 normal-case tracking-normal">Optional</span>
                                                </label>
                                            </div>
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
                                                className="w-full px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-bold focus:outline-none focus:border-blue-600 transition-colors disabled:opacity-50 disabled:bg-gray-50"
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
                        <div className="bg-white border-2 border-gray-900 p-5">
                            <div className="mb-5 pb-4 border-b-2 border-gray-100">
                                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                                    Step 2
                                </p>
                                <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                                    Customer Information
                                </h3>
                            </div>
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
                        </div>
                    )}

                    {/* ── STEP 3: Agreement + Signature ── */}
                    {currentStep === 'agreement' && (
                        <div className="bg-white border-2 border-gray-900 p-5">
                            <div className="mb-5 pb-4 border-b-2 border-gray-100">
                                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                                    Step 3
                                </p>
                                <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                                    Review & Sign
                                </h3>
                            </div>
                            <RepairAgreement
                                formData={formData}
                                signatureData={signatureData}
                                onSignatureChange={setSignatureData}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* ── Footer Navigation ── */}
            <div className="flex-shrink-0 bg-white border-t-2 border-gray-900">
                {/* Product step: Add More + Continue */}
                {currentStep === 'product' && (
                    <div className="flex">
                        {productSelected && (
                            <button
                                onClick={() => {
                                    const scrollEl = document.querySelector('.scrollbar-hide');
                                    scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="flex items-center justify-center gap-2 px-6 py-5 border-r-2 border-gray-900 text-xs font-black uppercase tracking-wide text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                            >
                                + Add More
                            </button>
                        )}
                        <button
                            onClick={handleNext}
                            disabled={!canProceedFromProduct}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed"
                        >
                            Continue
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Customer step: Back + Continue */}
                {currentStep === 'customer' && (
                    <div className="flex">
                        <button
                            onClick={handleBack}
                            className="flex items-center justify-center gap-2 px-6 py-5 border-r-2 border-gray-900 text-xs font-black uppercase tracking-wide text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={!canProceedFromCustomer}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed"
                        >
                            Continue
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Agreement step: Back + Submit */}
                {currentStep === 'agreement' && (
                    <div className="flex">
                        <button
                            onClick={handleBack}
                            className="flex items-center justify-center gap-2 px-6 py-5 border-r-2 border-gray-900 text-xs font-black uppercase tracking-wide text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!canSubmit || isSubmitting}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    Submit Repair
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Signature required hint on agreement step */}
                {currentStep === 'agreement' && !signatureData && (
                    <div className="px-5 py-2 bg-amber-50 border-t border-amber-200">
                        <p className="text-[9px] font-black uppercase tracking-wide text-amber-700">
                            Signature required to submit
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
