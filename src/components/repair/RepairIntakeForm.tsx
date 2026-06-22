'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, Wrench, X, Check } from '../Icons';
import { ProductSelector, type SelectedItem } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm, CONTACT_FIELDS } from './CustomerInfoForm';
import { SignaturePad, type SignatureData } from './SignaturePad';
import RepairServiceForm from './RepairServiceForm';
import {
    RepairIntakeStepper,
    type RepairIntakeStepKey,
} from './RepairIntakeStepper';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import { RepairPaperworkSheet } from './RepairPaperworkSheet';
import { TextField, FloatingButton } from '@/design-system/primitives';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import { REPAIR_STEP_COPY, buildInitialFormData, formatPhone, isContactFieldValid } from './repair-intake-logic';
import { useRepairIntakeData } from './useRepairIntakeData';
import { useRepairCustomerSearch, type ExistingCustomer } from './useRepairCustomerSearch';

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

const REPAIR_INTAKE_MAX_WIDTH = 'max-w-[720px]';
const REPAIR_INTAKE_COLUMN_CLASS = `mx-auto w-full ${REPAIR_INTAKE_MAX_WIDTH}`;

export function RepairIntakeForm({ onClose, onSubmit, initialData, favoriteSkuId }: RepairIntakeFormProps) {
    const [currentStep, setCurrentStep] = useState<RepairIntakeStepKey>('product');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState<RepairFormData>(() => buildInitialFormData(initialData));
    const [signatureData, setSignatureData] = useState<SignatureData | null>(null);
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

    const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
    const [customerQuery, setCustomerQuery] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
    const [contactFieldIndex, setContactFieldIndex] = useState(0);

    const { techs, loadingTechs, skuIssues } = useRepairIntakeData(favoriteSkuId);
    const { customerResults, loadingCustomers, customerSearchError } = useRepairCustomerSearch(
        currentStep === 'contact' && customerMode === 'existing',
        customerQuery,
    );

    useEffect(() => {
        setFormData(buildInitialFormData(initialData));
    }, [initialData]);

    useEffect(() => {
        if (currentStep !== 'contact') {
            setContactFieldIndex(0);
        }
    }, [currentStep]);

    useEffect(() => {
        setContactFieldIndex(0);
    }, [customerMode]);

    const productSelected = !!(formData.product.type && formData.product.model);

    const canProceedFromProduct = productSelected;

    const canProceedFromIssue =
        formData.repairReasons.length > 0 || formData.repairNotes.trim().length > 0;

    const activeContactField = CONTACT_FIELDS[contactFieldIndex] ?? CONTACT_FIELDS[0];
    const isExistingSearch = currentStep === 'contact' && customerMode === 'existing';
    const canProceedFromContactField = isContactFieldValid(activeContactField, formData);
    const canProceedFromContact = CONTACT_FIELDS.every((field) => isContactFieldValid(field, formData));
    const isLastContactField = contactFieldIndex >= CONTACT_FIELDS.length - 1;

    const canSubmit = canProceedFromContact && !!signatureData;

    const issueText =
        [...formData.repairReasons, formData.repairNotes ? formData.repairNotes : null]
            .filter(Boolean)
            .join(', ') || '';

    const today = new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
    });

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

    const handleUseFavorite = (favorite: FavoriteSkuRecord) => {
        const syntheticItem: SelectedItem = {
            id: `fav-${favorite.id}`,
            name: favorite.productTitle || favorite.label || favorite.sku,
            price: favorite.defaultPrice ? parseFloat(favorite.defaultPrice) : null,
            sku: favorite.sku,
        };
        handleSelectedItemsChange([syntheticItem]);
        const notes = favorite.issueTemplate || favorite.label || 'Repair';
        setFormData(prev => ({
            ...prev,
            repairNotes: notes,
        }));
        setCurrentStep('issue');
    };

    const handleNext = () => {
        if (currentStep === 'product' && canProceedFromProduct) {
            setCurrentStep('issue');
        } else if (currentStep === 'issue' && canProceedFromIssue) {
            setCurrentStep('contact');
        } else if (currentStep === 'contact') {
            if (isExistingSearch) return;
            if (!isLastContactField) {
                setContactFieldIndex((prev) => prev + 1);
            } else if (canProceedFromContact) {
                setCurrentStep('review');
            }
        }
    };

    const handleBack = () => {
        if (currentStep === 'issue') setCurrentStep('product');
        else if (currentStep === 'contact') {
            if (contactFieldIndex > 0) {
                setContactFieldIndex((prev) => prev - 1);
            } else {
                setCurrentStep('issue');
            }
        } else if (currentStep === 'review') {
            setContactFieldIndex(CONTACT_FIELDS.length - 1);
            setCurrentStep('contact');
        }
    };

    const handleStepClick = (key: RepairIntakeStepKey) => {
        if (key === 'product') {
            setCurrentStep('product');
            return;
        }
        if (key === 'issue' && canProceedFromProduct) {
            setCurrentStep('issue');
            return;
        }
        if (key === 'contact' && canProceedFromProduct && canProceedFromIssue) {
            setContactFieldIndex(0);
            setCurrentStep('contact');
            return;
        }
        if (key === 'review' && canProceedFromContact) {
            setCurrentStep('review');
        }
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
        setContactFieldIndex(0);
        setFormData((prev) => ({
            ...prev,
            customer: {
                name: customer.name || prev.customer.name,
                phone: customer.phone || '',
                email: customer.email || '',
            },
        }));
    };

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

    const stepTitle = REPAIR_STEP_COPY[currentStep].title;
    const stepSubtitle = REPAIR_STEP_COPY[currentStep].subtitle;

    const isReviewStep = currentStep === 'review';

    const primaryDisabled = isReviewStep
        ? !canSubmit || isSubmitting
        : currentStep === 'product'
            ? !canProceedFromProduct
            : currentStep === 'issue'
                ? !canProceedFromIssue
                : isExistingSearch
                    ? true
                    : !canProceedFromContactField;

    const primaryLabel = isReviewStep
        ? isSubmitting
            ? 'Submitting…'
            : 'Submit repair'
        : 'Continue';

    const primaryTitle = isReviewStep && !signatureData
        ? 'Signature required to submit'
        : primaryDisabled
            ? 'Complete the required fields to continue'
            : undefined;

    return (
        <div className="relative flex h-full w-full flex-col bg-white text-gray-900">
            {/* Header — title row + stepper aligned to the 720px content column */}
            <header className="shrink-0 border-b border-gray-100">
                <div className={`${REPAIR_INTAKE_COLUMN_CLASS} px-6 py-3`}>
                    <div className="relative flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                            {currentStep !== 'product' ? (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-900 hover:text-gray-900"
                                    aria-label="Go back"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                            ) : (
                                <div
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-900"
                                    aria-hidden
                                >
                                    <Wrench className="h-4 w-4" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="truncate text-xs font-black uppercase tracking-[0.12em] text-gray-900 sm:text-sm">
                                    Repair Intake
                                </h1>
                                <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400 sm:text-[10px]">
                                    {stepTitle}
                                </p>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {/* Paperwork affordance — present on every step so the
                                repair agreement is viewable at any point (acceptance B). */}
                            <RepairPaperworkSheet formData={formData} />
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:border-gray-900 hover:text-gray-900"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="mt-4">
                        <RepairIntakeStepper
                            spread
                            currentStep={currentStep}
                            onStepClick={handleStepClick}
                            canNavigateTo={(key) => {
                                if (key === 'product') return true;
                                if (key === 'issue') return canProceedFromProduct;
                                if (key === 'contact') return canProceedFromProduct && canProceedFromIssue;
                                return canProceedFromContact;
                            }}
                        />
                    </div>
                </div>
            </header>

            {/* Step body — single centered column, no sidebar split */}
            <main className="min-h-0 flex-1 overflow-y-auto pb-28">
                <div className={`${REPAIR_INTAKE_COLUMN_CLASS} px-6 py-8`}>
                    <p className="mb-8 text-center text-sm leading-relaxed text-gray-500">
                        {stepSubtitle}
                    </p>

                    {currentStep === 'product' && (
                        <div className="space-y-8">
                            <FavoritesWorkspaceSection
                                variant="quick-pick"
                                workspaceKey="repair"
                                accent="blue"
                                title="Common Repairs"
                                description=""
                                emptyLabel="No repair favorites yet"
                                useLabel="Start repair"
                                allowRepairDefaults
                                onUseFavorite={handleUseFavorite}
                                searchSkuSuffixFilter="-RS"
                                fuzzyTitleSearch
                            />

                            <div className="rounded-2xl border border-gray-200 p-4">
                                <ProductSelector
                                    onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                                    selectedProduct={formData.product.type ? formData.product : null}
                                    onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                                    fillHeight
                                    selectedItems={selectedItems}
                                    onSelectedItemsChange={handleSelectedItemsChange}
                                />
                            </div>
                        </div>
                    )}

                    {currentStep === 'issue' && (
                        <div className="w-full space-y-6">
                            {productSelected && (
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center">
                                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">
                                        Selected product
                                    </p>
                                    <p className="mt-1 text-sm font-bold text-gray-900">{formData.product.model}</p>
                                </div>
                            )}

                            <div className="rounded-2xl border border-gray-200 p-5">
                                <ReasonSelector
                                    selectedReasons={formData.repairReasons}
                                    notes={formData.repairNotes}
                                    onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                                    onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                                    skuIssues={skuIssues}
                                />
                            </div>

                            <div>
                                <label
                                    htmlFor="repair-tech-select"
                                    className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-gray-500"
                                >
                                    Assign technician <span className="font-bold text-gray-300">(optional)</span>
                                </label>
                                <select
                                    id="repair-tech-select"
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
                                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-900 outline-none transition-all focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                                >
                                    <option value="">Unassigned</option>
                                    {techs.map(tech => (
                                        <option key={tech.id} value={tech.id}>{tech.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {currentStep === 'contact' && (
                        <div className="w-full space-y-6">
                            <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 p-1">
                                <button
                                    type="button"
                                    onClick={() => setCustomerMode('existing')}
                                    className={`rounded-lg py-2.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
                                        customerMode === 'existing'
                                            ? 'bg-gray-900 text-white'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    Existing
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCustomerMode('new')}
                                    className={`rounded-lg py-2.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
                                        customerMode === 'new'
                                            ? 'bg-gray-900 text-white'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    New
                                </button>
                            </div>

                            {customerMode === 'existing' && (
                                <div className="space-y-3">
                                    <TextField
                                        label="Search customer"
                                        value={customerQuery}
                                        onChange={setCustomerQuery}
                                        tone="neutral"
                                    />
                                    <div className="overflow-hidden rounded-xl border border-gray-200">
                                        <div className="grid grid-cols-[1fr_1fr_0.55fr] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                                            <span>Name</span>
                                            <span>Phone</span>
                                            <span className="text-right">Action</span>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto">
                                            {loadingCustomers && (
                                                <div className="px-3 py-3 text-xs font-semibold text-gray-400">Loading…</div>
                                            )}
                                            {!loadingCustomers && customerSearchError && (
                                                <div className="px-3 py-3 text-xs font-semibold text-red-600">{customerSearchError}</div>
                                            )}
                                            {!loadingCustomers && !customerSearchError && customerResults.length === 0 && (
                                                <div className="px-3 py-3 text-xs font-semibold text-gray-400">No customers found.</div>
                                            )}
                                            {!loadingCustomers && !customerSearchError && customerResults.map((customer) => (
                                                <div
                                                    key={customer.id}
                                                    className={`grid grid-cols-[1fr_1fr_0.55fr] gap-2 border-b border-gray-50 px-3 py-2.5 text-xs ${
                                                        selectedCustomerId === customer.id ? 'bg-gray-50' : 'bg-white'
                                                    }`}
                                                >
                                                    <span className="truncate font-bold text-gray-900">{customer.name}</span>
                                                    <span className="truncate text-gray-600">{customer.phone || '—'}</span>
                                                    <div className="text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => applyExistingCustomer(customer)}
                                                            className="rounded-lg bg-gray-900 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white hover:bg-black"
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

                            {!isExistingSearch && (
                                <CustomerInfoForm
                                    customer={formData.customer}
                                    serialNumber={formData.serialNumber}
                                    price={formData.price}
                                    notes={formData.notes}
                                    activeField={activeContactField}
                                    fieldIndex={contactFieldIndex}
                                    fieldCount={CONTACT_FIELDS.length}
                                    onCustomerChange={updateCustomer}
                                    onSerialNumberChange={(value) => setFormData(prev => ({ ...prev, serialNumber: value }))}
                                    onPriceChange={(value) => setFormData(prev => ({ ...prev, price: value }))}
                                    onNotesChange={(value) => setFormData(prev => ({ ...prev, notes: value }))}
                                />
                            )}
                        </div>
                    )}

                    {currentStep === 'review' && (
                        <div className="space-y-8">
                            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                                <RepairServiceForm {...receiptProps} variant="preview" />
                            </div>

                            <div className="w-full space-y-2 rounded-xl border border-gray-200 bg-gray-50/80 px-5 py-4 text-center">
                                <p className="text-xs leading-relaxed text-gray-600">
                                    By signing below, the customer consents to conduct this transaction electronically
                                    and agrees to the listed repair price, terms, and any unexpected delays.
                                </p>
                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-900">
                                    30-Day Warranty on all repair services
                                </p>
                            </div>

                            <div className="w-full space-y-3">
                                <p className="text-center text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
                                    Customer signature
                                </p>
                                <div className="h-[220px] overflow-hidden rounded-2xl border-2 border-gray-900 bg-white">
                                    <SignaturePad onSignatureChange={setSignatureData} fillHeight />
                                </div>
                                {signatureData && (
                                    <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700">
                                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-900">
                                            <Check className="h-2.5 w-2.5 text-white" />
                                        </span>
                                        Signature captured
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <FloatingButton
                label={primaryLabel}
                onClick={isReviewStep ? handleSubmit : handleNext}
                disabled={primaryDisabled}
                loading={isSubmitting}
                title={primaryTitle}
                tone="gray"
                maxWidth={REPAIR_INTAKE_MAX_WIDTH}
                fullWidth
                className="px-0 sm:px-0"
            />
        </div>
    );
}
