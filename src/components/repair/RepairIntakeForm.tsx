'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, Wrench, X, Check, Printer, Loader2 } from '../Icons';
import { ProductSelector, type SelectedItem } from './ProductSelector';
import { ReasonSelector } from './ReasonSelector';
import { CustomerInfoForm, CONTACT_FIELDS } from './CustomerInfoForm';
import { SignaturePad, type SignatureData } from './SignaturePad';
import RepairServiceForm from './RepairServiceForm';
import { RepairPaperworkCanvas } from './RepairPaperworkCanvas';
import {
    RepairIntakeStepper,
    type RepairIntakeStepKey,
} from './RepairIntakeStepper';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import { RepairPaperworkSheet } from './RepairPaperworkSheet';
import { TextField, FloatingButton, Button, IconButton } from '@/design-system/primitives';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import { REPAIR_STEP_COPY, buildInitialFormData, isContactFieldValid, canSubmitRepairIntake, getRepairSubmitBlockReason, hasRepairIssue, isContactComplete, isProductSelected } from './repair-intake-logic';
import { useRepairIntakeData } from './useRepairIntakeData';
import { useRepairCustomerSearch, type ExistingCustomer } from './useRepairCustomerSearch';
import { buildDraftFromFavorite, favoriteToSelectedItems, fetchFavoriteIntakeContext } from './repair-favorite-intake';
import { buildRepairIntakeReceiptProps } from '@/lib/repair/repair-intake-receipt';
import { formatRepairSubmittedChromeLabel } from '@/lib/repair/repair-paper-ticket';

/** What the submit handler resolves with on a successful post, so the form can
 *  show the printable paper instead of dropping back to the walk-in dashboard. */
export interface RepairSubmitResult {
    id: number;
    rsNumber?: string | number | null;
    zendeskTicketNumber?: string | null;
    zendeskTicketUrl?: string | null;
}

interface RepairIntakeFormProps {
    onClose: () => void;
    /** Resolve with the created repair on success; resolve null/throw on failure. */
    onSubmit: (data: RepairFormData) => Promise<RepairSubmitResult | null | void>;
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
const SECTION_LABEL = 'text-micro font-black uppercase tracking-[0.16em] text-gray-500';

export function RepairIntakeForm({ onClose, onSubmit, initialData, favoriteSkuId }: RepairIntakeFormProps) {
    const [currentStep, setCurrentStep] = useState<RepairIntakeStepKey>('product');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isFetchingFavorite, setIsFetchingFavorite] = useState(false);
    const [showPaperwork, setShowPaperwork] = useState(false);
    const [submitted, setSubmitted] = useState<RepairSubmitResult | null>(null);

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

    // Single orchestrated reveal when the step (or contact field) changes — a quiet
    // settle, never on every keystroke. Honors prefers-reduced-motion via motion-reduce:.
    const [stepRevealed, setStepRevealed] = useState(true);
    useEffect(() => {
        setStepRevealed(false);
        const raf = requestAnimationFrame(() => setStepRevealed(true));
        return () => cancelAnimationFrame(raf);
    }, [currentStep, contactFieldIndex]);

    const productSelected = isProductSelected(formData);

    const canProceedFromProduct = productSelected;

    const canProceedFromIssue = hasRepairIssue(formData);

    const activeContactField = CONTACT_FIELDS[contactFieldIndex] ?? CONTACT_FIELDS[0];
    const isExistingSearch = currentStep === 'contact' && customerMode === 'existing';
    const canProceedFromContactField = isContactFieldValid(activeContactField, formData);
    const canProceedFromContact = isContactComplete(formData);
    const isLastContactField = contactFieldIndex >= CONTACT_FIELDS.length - 1;

    const canSubmit = canSubmitRepairIntake(formData, !!signatureData);

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
        if (items.length === 0) {
            setFormData((prev) => {
                if (prev.product.type === 'Other' && prev.product.model.trim()) return prev;
                return {
                    ...prev,
                    product: { type: '', model: '', sourceSku: null },
                };
            });
            return;
        }
        const model = items.map((i) => i.name).join(', ');
        const sku = items.map((i) => String(i.sku || '').trim()).find(Boolean) || null;
        const price = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
        setFormData(prev => ({
            ...prev,
            product: { type: 'Bose Repair Service', model, sourceSku: sku },
            price: price > 0 ? price.toFixed(2) : prev.price,
        }));
    };

    const handleUseFavorite = async (favorite: FavoriteSkuRecord) => {
        setIsFetchingFavorite(true);
        try {
            const { ecwidProduct, skuReasons } = await fetchFavoriteIntakeContext(favorite);
            const items = favoriteToSelectedItems(favorite, ecwidProduct);
            const draft = buildDraftFromFavorite(favorite, ecwidProduct, skuReasons);
            setSelectedItems(items);
            setFormData((prev) => ({
                ...prev,
                ...draft,
                product: draft.product ?? prev.product,
                customer: prev.customer,
                serialNumber: prev.serialNumber,
            }));
            setCurrentStep('issue');
        } finally {
            setIsFetchingFavorite(false);
        }
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
        if (key === 'review' && canProceedFromProduct && canProceedFromIssue && canProceedFromContact) {
            setCurrentStep('review');
        }
    };

    const handleSubmit = async () => {
        if (!canSubmit || !signatureData) return;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const result = await onSubmit({
                ...formData,
                signatureDataUrl: signatureData.dataUrl,
                signatureStrokes: signatureData.strokes,
            });
            // On success, hold the full-screen overlay and show the printable paper —
            // never reveal the walk-in dashboard to a waiting customer.
            if (result && Number.isFinite(result.id)) {
                setSubmitted(result);
            } else {
                setIsSubmitting(false);
            }
        } catch (error) {
            console.error('Error submitting form:', error);
            setSubmitError(
                error instanceof Error ? error.message : 'Error submitting repair form. Please try again.',
            );
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

    const receiptProps = buildRepairIntakeReceiptProps(formData, issueText, today);

    const stepTitle = REPAIR_STEP_COPY[currentStep].title;

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

    const primaryTitle = isReviewStep
        ? getRepairSubmitBlockReason(formData, !!signatureData)
        : primaryDisabled
            ? 'Complete the required fields to continue'
            : undefined;

    // Post-submit: the repair is persisted and the Zendesk ticket is created.
    // Stay full-screen and present the exact paper to print — the customer never
    // sees the walk-in dashboard, and staff print straight from here.
    if (submitted) {
        const chromeLabel = formatRepairSubmittedChromeLabel(submitted.zendeskTicketNumber);
        const printHref = `/api/repair-service/print/${submitted.id}`;
        const submittedReceiptProps = buildRepairIntakeReceiptProps(
            formData,
            issueText,
            today,
            submitted.zendeskTicketNumber ?? '',
        );

        return (
            <div className="relative flex h-full w-full flex-col bg-white text-gray-900">
                <header className="shrink-0 border-b border-gray-100">
                    <div className={`${REPAIR_INTAKE_COLUMN_CLASS} flex items-center justify-between gap-3 px-6 py-3`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                                <Check className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-eyebrow font-bold uppercase tracking-[0.18em] text-gray-400 sm:text-micro">
                                    Repair submitted
                                </p>
                                <h1 className="truncate text-sm font-black tracking-tight text-gray-900 sm:text-[15px]">
                                    {chromeLabel}
                                </h1>
                            </div>
                        </div>
                        <IconButton
                            onClick={onClose}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 transition-colors hover:border-gray-900"
                            ariaLabel="Done"
                            icon={<X className="h-4 w-4" />}
                        />
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto bg-gray-100">
                    <div className="px-4 py-4 sm:px-6 sm:py-5">
                        <RepairPaperworkCanvas>
                            <RepairServiceForm {...submittedReceiptProps} surface="screen" />
                        </RepairPaperworkCanvas>
                    </div>
                </main>

                <div className="shrink-0 border-t border-gray-100 bg-white">
                    <div className={`${REPAIR_INTAKE_COLUMN_CLASS} flex items-center gap-3 px-6 py-3`}>
                        {submitted.zendeskTicketUrl ? (
                            <a
                                href={submitted.zendeskTicketUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-micro font-black uppercase tracking-[0.14em] text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
                            >
                                {submitted.zendeskTicketNumber ? `Ticket ${submitted.zendeskTicketNumber}` : 'View ticket'}
                            </a>
                        ) : null}
                        <div className="ml-auto flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="md"
                                onClick={onClose}
                            >
                                Done
                            </Button>
                            <Button
                                variant="brand"
                                size="md"
                                icon={<Printer className="h-4 w-4" />}
                                onClick={() => window.open(printHref, '_blank', 'noopener,noreferrer')}
                            >
                                Print document
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full flex-col bg-white text-gray-900">
            {/* Header — title row + stepper aligned to the 720px content column */}
            <header className="shrink-0 border-b border-gray-100">
                <div className={`${REPAIR_INTAKE_COLUMN_CLASS} px-6 py-3`}>
                    <div className="relative flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                            {currentStep !== 'product' ? (
                                <IconButton
                                    onClick={handleBack}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 transition-colors hover:border-gray-900"
                                    ariaLabel="Go back"
                                    icon={<ChevronLeft className="h-4 w-4" />}
                                />
                            ) : (
                                <div
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-900"
                                    aria-hidden
                                >
                                    <Wrench className="h-4 w-4" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="truncate text-eyebrow font-bold uppercase tracking-[0.18em] text-gray-400 sm:text-micro">
                                    Repair Intake
                                </p>
                                <h1
                                    id="repair-intake-step-title"
                                    className="truncate text-sm font-black tracking-tight text-gray-900 sm:text-[15px]"
                                >
                                    {stepTitle}
                                </h1>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {/* Paperwork affordance — present on every step so the
                                repair agreement is viewable at any point (acceptance B). */}
                            <RepairPaperworkSheet
                                active={showPaperwork}
                                onToggle={() => setShowPaperwork((v) => !v)}
                            />
                            <IconButton
                                onClick={onClose}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 transition-colors hover:border-gray-900"
                                ariaLabel="Close"
                                icon={<X className="h-4 w-4" />}
                            />
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
                                return canProceedFromProduct && canProceedFromIssue && canProceedFromContact;
                            }}
                        />
                    </div>
                </div>
            </header>

            {/* Step body — single centered column, no sidebar split */}
            <main
                aria-labelledby="repair-intake-step-title"
                className={`min-h-0 flex-1 overflow-y-auto ${showPaperwork ? 'bg-gray-100' : 'pb-28'}`}
            >
                {showPaperwork ? (
                    <div className="bg-gray-100 px-4 py-4 sm:px-6 sm:py-5">
                        <RepairPaperworkCanvas>
                            <RepairServiceForm {...receiptProps} surface="screen" />
                        </RepairPaperworkCanvas>
                    </div>
                ) : (
                <div
                    className={`${REPAIR_INTAKE_COLUMN_CLASS} px-6 transition-all duration-300 ease-out motion-reduce:translate-y-0 motion-reduce:transition-none ${
                        currentStep === 'review' ? 'py-4' : 'py-8'
                    } ${
                        stepRevealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                    }`}
                >
                    {currentStep === 'product' && (
                        <div className="relative space-y-8">
                            {isFetchingFavorite && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-sm">
                                    <div className="flex items-center gap-2 text-gray-700">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span className={SECTION_LABEL}>Loading product…</span>
                                    </div>
                                </div>
                            )}
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

                            <section className="space-y-3">
                                <p className={SECTION_LABEL}>All products</p>
                                <ProductSelector
                                    onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                                    selectedProduct={formData.product.type ? formData.product : null}
                                    onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                                    fillHeight
                                    selectedItems={selectedItems}
                                    onSelectedItemsChange={handleSelectedItemsChange}
                                />
                            </section>
                        </div>
                    )}

                    {currentStep === 'issue' && (
                        <div className="w-full space-y-7">
                            {productSelected && (
                                <div className="space-y-1">
                                    <p className={SECTION_LABEL}>Selected product</p>
                                    <p className="text-sm font-bold text-gray-900">{formData.product.model}</p>
                                </div>
                            )}

                            <ReasonSelector
                                selectedReasons={formData.repairReasons}
                                notes={formData.repairNotes}
                                onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                                onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                                skuIssues={skuIssues}
                            />

                            <div className="space-y-2">
                                <label
                                    htmlFor="repair-tech-select"
                                    className={`block ${SECTION_LABEL}`}
                                >
                                    Assign technician <span className="font-bold lowercase text-gray-300">(optional)</span>
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
                                <Button
                                    variant={customerMode === 'existing' ? 'brand' : 'ghost'}
                                    size="md"
                                    onClick={() => setCustomerMode('existing')}
                                    className="w-full"
                                >
                                    Existing
                                </Button>
                                <Button
                                    variant={customerMode === 'new' ? 'brand' : 'ghost'}
                                    size="md"
                                    onClick={() => setCustomerMode('new')}
                                    className="w-full"
                                >
                                    New
                                </Button>
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
                                        <div className="grid grid-cols-[1fr_1fr_0.55fr] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-eyebrow font-black uppercase tracking-[0.12em] text-gray-500">
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
                                                        <Button
                                                            variant="brand"
                                                            size="sm"
                                                            onClick={() => applyExistingCustomer(customer)}
                                                        >
                                                            Select
                                                        </Button>
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
                        <div className="w-full">
                            <div className="w-full border border-black bg-white">
                                <RepairServiceForm {...receiptProps} density="compact" />

                                <div className="border-t border-black px-4 py-3">
                                    <p className="text-xs leading-relaxed text-gray-500">
                                        By signing below, the customer consents to conduct this transaction electronically
                                        and agrees to the listed repair price, terms, and any unexpected delays.
                                    </p>

                                    {submitError && (
                                        <p
                                            role="alert"
                                            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                                        >
                                            {submitError}
                                        </p>
                                    )}
                                </div>

                                <div className="h-[200px] overflow-hidden border-t border-black bg-white">
                                    <SignaturePad
                                        onSignatureChange={(data) => {
                                            setSignatureData(data);
                                            if (data) setSubmitError(null);
                                        }}
                                        fillHeight
                                        variant="dropoff"
                                    />
                                </div>
                            </div>

                            {signatureData && (
                                <div className="mt-3 flex items-center gap-2 text-micro font-black uppercase tracking-[0.14em] text-gray-700">
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-900">
                                        <Check className="h-2.5 w-2.5 text-white" />
                                    </span>
                                    Signature captured
                                </div>
                            )}
                        </div>
                    )}
                </div>
                )}
            </main>

            {!showPaperwork && (
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
            )}
        </div>
    );
}
