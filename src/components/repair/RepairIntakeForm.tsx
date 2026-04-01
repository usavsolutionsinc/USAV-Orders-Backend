'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getActiveStaff } from '@/lib/staffCache';
import { ChevronLeft, Loader2 } from '../Icons';
import { ProductSelector } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { RepairAgreement } from './RepairAgreement';
import type { SignatureData } from './SignaturePad';
import {
    SidebarIntakeFormShell,
    SidebarIntakeFormField,
    getSidebarIntakeInputClass,
    getSidebarIntakeSubmitButtonClass,
} from '@/design-system/components';

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

interface ExistingCustomer {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    updated_at: string | null;
}

type FormStep = 'product' | 'customer' | 'agreement';

const STEPS: { key: FormStep; label: string }[] = [
    { key: 'product', label: 'Product & Issue' },
    { key: 'customer', label: 'Customer Info' },
    { key: 'agreement', label: 'Review & Sign' },
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
    const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
    const [customerQuery, setCustomerQuery] = useState('');
    const [customerResults, setCustomerResults] = useState<ExistingCustomer[]>([]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [customerSearchError, setCustomerSearchError] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

    const orangeSubmitButtonClass = getSidebarIntakeSubmitButtonClass('orange');
    const orangeInputClass = getSidebarIntakeInputClass('orange');

    useEffect(() => {
        let active = true;
        getActiveStaff()
            .then((data) => {
                if (active) setTechs(data.filter((m) => m.role === 'technician'));
            })
            .catch(() => setTechs([]))
            .finally(() => setLoadingTechs(false));
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        const url = favoriteSkuId
            ? `/api/repair/issues?favoriteSkuId=${favoriteSkuId}`
            : '/api/repair/issues';
        fetch(url)
            .then(r => r.json())
            .then(data => {
                if (active) setSkuIssues(
                    Array.isArray(data?.issues) ? data.issues.map((i: { label: string }) => i.label) : [],
                );
            })
            .catch(() => { if (active) setSkuIssues([]); });
        return () => { active = false; };
    }, [favoriteSkuId]);

    useEffect(() => {
        setFormData(buildInitialFormData(initialData));
    }, [initialData]);

    useEffect(() => {
        if (currentStep !== 'customer' || customerMode !== 'existing') return;

        let active = true;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoadingCustomers(true);
            setCustomerSearchError('');
            try {
                const q = customerQuery.trim();
                const res = await fetch(`/api/repair/customers?q=${encodeURIComponent(q)}&limit=25`, {
                    signal: controller.signal,
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(payload?.error || 'Failed to fetch customers');
                }
                if (!active) return;
                const rows = Array.isArray(payload?.customers) ? payload.customers : [];
                setCustomerResults(rows);
            } catch (error: any) {
                if (!active || controller.signal.aborted) return;
                setCustomerResults([]);
                setCustomerSearchError(String(error?.message || 'Failed to fetch customers'));
            } finally {
                if (active) setLoadingCustomers(false);
            }
        }, 220);

        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [currentStep, customerMode, customerQuery]);

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

    const applyExistingCustomer = (customer: ExistingCustomer) => {
        setSelectedCustomerId(customer.id);
        setCustomerMode('new');
        setFormData((prev) => ({
            ...prev,
            customer: {
                name: customer.name || prev.customer.name,
                phone: customer.phone || '',
                email: customer.email || '',
            },
        }));
    };

    const formatUpdatedAt = (value: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    };

    const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);
    const progress = ((currentStepIndex + 1) / STEPS.length) * 100;

    const footerContent = (() => {
        if (currentStep === 'product') {
            return (
                <div className="flex items-center gap-3">
                    {productSelected && (
                        <button
                            type="button"
                            onClick={() => {
                                const scrollEl = document.querySelector('.scrollbar-hide');
                                scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
                        >
                            + Add More
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleNext}
                        disabled={!canProceedFromProduct}
                        className={orangeSubmitButtonClass}
                    >
                        Continue
                    </button>
                </div>
            );
        }
        if (currentStep === 'customer') {
            return (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleBack}
                        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Back
                    </button>
                    <button
                        type="button"
                        onClick={handleNext}
                        disabled={!canProceedFromCustomer}
                        className={orangeSubmitButtonClass}
                    >
                        Continue
                    </button>
                </div>
            );
        }
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleBack}
                        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Back
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit || isSubmitting}
                        className={orangeSubmitButtonClass}
                    >
                        {isSubmitting ? (
                            <span className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Submitting...
                            </span>
                        ) : (
                            'Submit Repair'
                        )}
                    </button>
                </div>
                {!signatureData && (
                    <p className="text-center text-[9px] font-bold uppercase tracking-wide text-amber-600">
                        Signature required to submit
                    </p>
                )}
            </div>
        );
    })();

    return (
        <SidebarIntakeFormShell
            title="Repair Intake"
            subtitle={STEPS[currentStepIndex].label}
            subtitleAccent="blue"
            onClose={onClose}
            bandBelowHeader={
                <div className="pb-4">
                    {/* Step labels */}
                    <div className="mb-2 flex items-center justify-between">
                        {STEPS.map((step, i) => (
                            <span
                                key={step.key}
                                className={`text-[9px] font-black uppercase tracking-wide ${
                                    i <= currentStepIndex ? 'text-blue-600' : 'text-gray-400'
                                }`}
                            >
                                {step.label}
                            </span>
                        ))}
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            }
            footer={footerContent}
        >
            {/* STEP 1: Product + Reason + Tech */}
            {currentStep === 'product' && (
                <div className="space-y-5">
                    <ProductSelector
                        onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                        selectedProduct={formData.product.type ? formData.product : null}
                        onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                    />

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
                            <div className="space-y-5">
                                <ReasonSelector
                                    selectedReasons={formData.repairReasons}
                                    notes={formData.repairNotes}
                                    onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                                    onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                                    skuIssues={skuIssues}
                                />

                                <SidebarIntakeFormField label="Assign Technician" optionalHint="(Optional)">
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
                                        className={orangeInputClass}
                                    >
                                        <option value="">-- Unassigned --</option>
                                        {techs.map(tech => (
                                            <option key={tech.id} value={tech.id}>{tech.name}</option>
                                        ))}
                                    </select>
                                </SidebarIntakeFormField>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* STEP 2: Customer Info */}
            {currentStep === 'customer' && (
                <div className="space-y-4">
                    <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setCustomerMode('existing')}
                                className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${
                                    customerMode === 'existing'
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'bg-white text-orange-700 border border-orange-200 hover:bg-orange-100'
                                }`}
                            >
                                Add From Existing
                            </button>
                            <button
                                type="button"
                                onClick={() => setCustomerMode('new')}
                                className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${
                                    customerMode === 'new'
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'bg-white text-orange-700 border border-orange-200 hover:bg-orange-100'
                                }`}
                            >
                                Create New
                            </button>
                        </div>

                        {customerMode === 'existing' && (
                            <div className="mt-3 space-y-2">
                                <input
                                    type="text"
                                    value={customerQuery}
                                    onChange={(e) => setCustomerQuery(e.target.value)}
                                    placeholder="Search by name, phone, or email"
                                    className={orangeInputClass}
                                />
                                <div className="overflow-hidden rounded-xl border border-orange-200 bg-white">
                                    <div className="grid grid-cols-[1.2fr_1fr_1.2fr_0.9fr_0.8fr] gap-2 border-b border-orange-100 bg-orange-50 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-orange-700">
                                        <span>Name</span>
                                        <span>Phone</span>
                                        <span>Email</span>
                                        <span>Updated</span>
                                        <span className="text-right">Action</span>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {loadingCustomers && (
                                            <div className="px-3 py-3 text-[10px] font-bold text-gray-500">Loading customers...</div>
                                        )}
                                        {!loadingCustomers && customerSearchError && (
                                            <div className="px-3 py-3 text-[10px] font-bold text-red-600">{customerSearchError}</div>
                                        )}
                                        {!loadingCustomers && !customerSearchError && customerResults.length === 0 && (
                                            <div className="px-3 py-3 text-[10px] font-bold text-gray-500">No customers found.</div>
                                        )}
                                        {!loadingCustomers && !customerSearchError && customerResults.map((customer) => (
                                            <div
                                                key={customer.id}
                                                className={`grid grid-cols-[1.2fr_1fr_1.2fr_0.9fr_0.8fr] gap-2 border-b border-gray-100 px-3 py-2 text-[10px] text-gray-700 ${
                                                    selectedCustomerId === customer.id ? 'bg-orange-50' : 'bg-white'
                                                }`}
                                            >
                                                <span className="truncate font-bold text-gray-900">{customer.name}</span>
                                                <span className="truncate">{customer.phone || '—'}</span>
                                                <span className="truncate">{customer.email || '—'}</span>
                                                <span>{formatUpdatedAt(customer.updated_at)}</span>
                                                <div className="text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => applyExistingCustomer(customer)}
                                                        className="rounded-md border border-orange-200 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-orange-700 hover:bg-orange-100"
                                                    >
                                                        Select
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-[9px] font-bold uppercase tracking-wide text-orange-700">
                                    Select a customer to prefill, then review/edit below.
                                </p>
                            </div>
                        )}
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
                        tone="orange"
                    />
                </div>
            )}

            {/* STEP 3: Agreement + Signature */}
            {currentStep === 'agreement' && (
                <RepairAgreement
                    formData={formData}
                    signatureData={signatureData}
                    onSignatureChange={setSignatureData}
                />
            )}
        </SidebarIntakeFormShell>
    );
}
