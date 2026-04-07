'use client';

import React, { useEffect, useState } from 'react';
import { getActiveStaff } from '@/lib/staffCache';
import { ChevronLeft, Loader2, X, Check } from '../Icons';
import { ProductSelector, type SelectedItem } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { SignaturePad, type SignatureData } from './SignaturePad';
import RepairServiceForm from './RepairServiceForm';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import {
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

    const [formData, setFormData] = useState<RepairFormData>(() => buildInitialFormData(initialData));
    const [signatureData, setSignatureData] = useState<SignatureData | null>(null);
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

    const totalPrice = selectedItems.reduce((sum, i) => sum + (i.price ?? 0), 0);

    const handleSelectedItemsChange = (items: SelectedItem[]) => {
        setSelectedItems(items);
        const model = items.map((i) => i.name).join(', ');
        const sku = items.map((i) => String(i.sku || '').trim()).find(Boolean) || null;
        const price = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
        setFormData(prev => ({
            ...prev,
            product: { type: items.length > 0 ? 'Bose Repair Service' : '', model, sourceSku: sku },
            price: price > 0 ? price.toFixed(2) : prev.price,
        }));
    };

    const removeSelectedItem = (id: string) => {
        handleSelectedItemsChange(selectedItems.filter(i => i.id !== id));
    };

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

    /* ── Data fetching ── */

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

    /* ── Derived state ── */

    const productSelected = !!(formData.product.type && formData.product.model);

    const canProceedFromProduct =
        productSelected &&
        (formData.repairReasons.length > 0 || formData.repairNotes.trim().length > 0);

    const canProceedFromCustomer =
        !!(formData.customer.name && formData.customer.phone && formData.serialNumber && formData.price);

    const canSubmit = canProceedFromCustomer && !!signatureData;

    const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

    const issueText =
        [...formData.repairReasons, formData.repairNotes ? formData.repairNotes : null]
            .filter(Boolean)
            .join(', ') || '';

    const today = new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
    });

    const formatPhone = (phone: string) => {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 10) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        }
        return phone;
    };

    /* ── Handlers ── */

    const handleUseFavorite = (favorite: FavoriteSkuRecord) => {
        setSelectedItems([]);
        const notes = favorite.issueTemplate || favorite.label || 'Repair';
        setFormData(prev => ({
            ...prev,
            product: {
                type: 'Bose Repair Service',
                model: favorite.productTitle || favorite.label || favorite.sku,
                sourceSku: favorite.sku,
            },
            price: favorite.defaultPrice || prev.price,
            repairNotes: notes,
        }));
        // Auto-advance to customer step
        setCurrentStep('customer');
    };

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

    /* ── Paper receipt props (shared by steps 2 & 3) ── */
    const receiptProps = {
        repairServiceId: '—',
        ticketNumber: '',
        productTitle: formData.product.model || '—',
        issue: issueText || '—',
        serialNumber: formData.serialNumber || '—',
        name: formData.customer.name || '—',
        contact: [
            formData.customer.phone ? formatPhone(formData.customer.phone) : '',
            formData.customer.email,
        ].filter(Boolean).join(', ') || '—',
        price: formData.price || '—',
        startDateTime: today,
    };

    /* ── Render ── */

    return (
        <div className="flex h-full w-full bg-gray-100">

            {/* ════════════════════════════════════════════════
                LEFT SIDEBAR (360px) — Form Inputs
               ════════════════════════════════════════════════ */}
            <aside className="flex w-[360px] shrink-0 flex-col border-r border-gray-200 bg-white">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                    <div>
                        <h2 className="text-[13px] font-black uppercase tracking-tight text-gray-900">
                            Repair Intake
                        </h2>
                        <p className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-orange-500">
                            {STEPS[currentStepIndex].label}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Progress bar + step indicator */}
                <div className="border-b border-gray-100 px-5 py-3 space-y-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-500 ease-out"
                            style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={currentStep === 'product'}
                            className="flex items-center gap-1 text-[10px] font-black text-gray-500 transition-colors hover:text-gray-900 disabled:invisible"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            Back
                        </button>
                        <span className="text-[10px] font-black text-gray-400">
                            {currentStepIndex + 1}/{STEPS.length}
                        </span>
                    </div>
                </div>

                {/* Step-specific sidebar content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-hide">

                    {/* ── STEP 1: Reasons + Tech ── */}
                    {currentStep === 'product' && (
                        <div className="space-y-4">
                            <div className={`transition-all duration-300 origin-top ${
                                productSelected
                                    ? 'opacity-100 translate-y-0'
                                    : 'opacity-0 -translate-y-2 pointer-events-none h-0 overflow-hidden'
                            }`}>
                                {productSelected && (
                                    <div className="space-y-4">
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

                            {/* Favorites — always visible */}
                            <FavoritesWorkspaceSection
                                workspaceKey="repair"
                                accent="orange"
                                title="Common Repairs"
                                description=""
                                emptyLabel="No repair favorites yet"
                                useLabel="Use"
                                allowRepairDefaults
                                inlineRows
                                buttonAccent="blue"
                                onUseFavorite={handleUseFavorite}
                                searchSkuSuffixFilter="-RS"
                                fuzzyTitleSearch
                                searchResultsMaxHeightClass="max-h-48"
                            />
                        </div>
                    )}

                    {/* ── STEP 2: Customer form inputs ── */}
                    {currentStep === 'customer' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setCustomerMode('existing')}
                                    className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
                                        customerMode === 'existing'
                                            ? 'bg-orange-600 text-white shadow-sm'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    Existing
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCustomerMode('new')}
                                    className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase tracking-wide transition-colors ${
                                        customerMode === 'new'
                                            ? 'bg-orange-600 text-white shadow-sm'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    New
                                </button>
                            </div>

                            {customerMode === 'existing' && (
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={customerQuery}
                                        onChange={(e) => setCustomerQuery(e.target.value)}
                                        placeholder="Search by name, phone, or email..."
                                        className={orangeInputClass}
                                    />
                                    <div className="overflow-hidden rounded-xl border border-orange-200 bg-white">
                                        <div className="grid grid-cols-[1fr_1fr_0.6fr] gap-2 border-b border-orange-100 bg-orange-50 px-3 py-2 text-[8px] font-black uppercase tracking-wider text-orange-700">
                                            <span>Name</span>
                                            <span>Phone</span>
                                            <span className="text-right">Action</span>
                                        </div>
                                        <div className="max-h-36 overflow-y-auto">
                                            {loadingCustomers && (
                                                <div className="px-3 py-3 text-[10px] font-bold text-gray-500">Loading...</div>
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
                                                    className={`grid grid-cols-[1fr_1fr_0.6fr] gap-2 border-b border-gray-100 px-3 py-2 text-[10px] text-gray-700 ${
                                                        selectedCustomerId === customer.id ? 'bg-orange-50' : 'bg-white'
                                                    }`}
                                                >
                                                    <span className="truncate font-bold text-gray-900">{customer.name}</span>
                                                    <span className="truncate">{customer.phone || '—'}</span>
                                                    <div className="text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => applyExistingCustomer(customer)}
                                                            className="rounded-md bg-orange-600 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-white hover:bg-orange-700 transition-colors"
                                                        >
                                                            Select
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

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

                    {/* ── STEP 3: Agreement text ── */}
                    {currentStep === 'agreement' && (
                        <div className="space-y-4">
                            <div className="space-y-2 text-[11px] text-gray-700 leading-relaxed border-l-4 border-orange-600 pl-4">
                                <p>
                                    Your Bose product has been received into our repair center. Under normal circumstances it will
                                    be repaired within the next <span className="font-black text-gray-900">3-10 working days</span> and returned to you.
                                </p>
                                <p className="font-black text-gray-900 uppercase tracking-wide text-[10px]">
                                    30-Day Warranty on all repair services.
                                </p>
                            </div>

                            <p className="text-[10px] text-gray-500 italic leading-relaxed bg-gray-50 p-3 border border-gray-200 rounded-xl">
                                By signing below, I consent to conduct this transaction electronically
                                and agree to the listed repair price, terms, and any unexpected delays in the repair process.
                            </p>

                            {signatureData && (
                                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500">
                                        <Check className="h-2.5 w-2.5 text-white" />
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-wide text-green-600">
                                        Signature captured
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer navigation */}
                <div className="border-t border-gray-100 px-5 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                        {currentStep !== 'product' && (
                            <button
                                type="button"
                                onClick={handleBack}
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[9px] font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
                            >
                                <ChevronLeft className="h-3 w-3" />
                                Back
                            </button>
                        )}

                        {currentStep === 'agreement' ? (
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!canSubmit || isSubmitting}
                                className={`flex-1 ${orangeSubmitButtonClass}`}
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
                        ) : (
                            <button
                                type="button"
                                onClick={handleNext}
                                disabled={
                                    currentStep === 'product'
                                        ? !canProceedFromProduct
                                        : !canProceedFromCustomer
                                }
                                className={`flex-1 ${orangeSubmitButtonClass}`}
                            >
                                Continue
                            </button>
                        )}
                    </div>

                    {currentStep === 'agreement' && !signatureData && (
                        <p className="text-center text-[8px] font-black uppercase tracking-wide text-amber-600">
                            Signature required to submit
                        </p>
                    )}
                </div>
            </aside>

            {/* ════════════════════════════════════════════════
                RIGHT MAIN — Display / Selection Area
               ════════════════════════════════════════════════ */}
            <main className="flex-1 flex flex-col overflow-hidden">

                {/* ── STEP 1: Full-width product grid ── */}
                {currentStep === 'product' && (
                    <div className="flex-1 flex flex-col overflow-hidden p-5">
                        <ProductSelector
                            onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                            selectedProduct={formData.product.type ? formData.product : null}
                            onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                            fillHeight
                            selectedItems={selectedItems}
                            onSelectedItemsChange={handleSelectedItemsChange}
                        />
                    </div>
                )}

                {/* ── STEP 2: Paper receipt (live preview) ── */}
                {currentStep === 'customer' && (
                    <div className="flex-1 overflow-y-auto flex items-start justify-center p-5">
                        <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white">
                            <div style={{ zoom: 0.7 }}>
                                <RepairServiceForm {...receiptProps} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 3 main area is replaced by full-screen signature below */}
            </main>

            {/* ════════════════════════════════════════════════
                STEP 3: Full-screen signature overlay
               ════════════════════════════════════════════════ */}
            {currentStep === 'agreement' && (
                <div className="fixed inset-0 z-[140] flex flex-col overflow-hidden bg-white">
                    {/* Header */}
                    <div className="shrink-0 flex items-center justify-between border-b border-gray-100 px-6 py-4">
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">
                                Customer Signature
                            </h2>
                            <p className="mt-0.5 text-[10px] font-bold text-gray-500">
                                {formData.customer.name} — {formData.product.model} — <span className="text-emerald-600">${formData.price}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setCurrentStep('customer')}
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[9px] font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
                            >
                                <ChevronLeft className="h-3 w-3" />
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
                    </div>

                    {/* Agreement text */}
                    <div className="shrink-0 border-b border-gray-100 px-6 py-3">
                        <p className="text-[11px] text-gray-500 italic leading-relaxed">
                            By signing below, I consent to conduct this transaction electronically
                            and agree to the listed repair price, terms, and any unexpected delays in the repair process.
                            <span className="ml-2 font-black text-gray-900 not-italic uppercase text-[10px]">30-Day Warranty</span>
                        </p>
                    </div>

                    {/* Full-screen signature pad */}
                    <div className="flex-1 min-h-0 p-6">
                        <SignaturePad onSignatureChange={setSignatureData} fillHeight />
                    </div>

                    <div className="shrink-0 border-t border-gray-100 px-6 py-3 text-center">
                        <p className={`text-[9px] font-black uppercase tracking-wide transition-opacity ${signatureData ? 'opacity-0' : 'text-amber-600'}`}>
                            Signature required to submit
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
