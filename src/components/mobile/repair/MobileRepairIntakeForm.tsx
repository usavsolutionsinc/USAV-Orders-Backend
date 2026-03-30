'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MobileShell } from '@/design-system/components/mobile/MobileShell';
import { getActiveStaff } from '@/lib/staffCache';
import { X, Check, ChevronLeft, ChevronRight } from '@/components/Icons';
import { ProductSelector } from '@/components/repair/ProductSelector';
import { ReasonSelector } from '@/components/repair/ReasonSelector';
import { MobileCustomerInfoForm } from './MobileCustomerInfoForm';
import { MobileRepairAgreement } from './MobileRepairAgreement';
import type { RepairFormData } from '@/components/repair/RepairIntakeForm';
import type { SignatureData } from '@/components/repair/SignaturePad';
import {
  framerTransitionMobile,
  framerPresenceMobile,
} from '@/design-system/foundations/motion-framer';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobileRepairIntakeFormProps {
  onClose: () => void;
  onSubmit: (data: RepairFormData) => void;
  initialData?: Partial<RepairFormData>;
  favoriteSkuId?: number | null;
}

interface TechStaff {
  id: number;
  name: string;
}

type FormStep = 'product' | 'customer' | 'agreement';

const STEPS: { key: FormStep; label: string; shortLabel: string }[] = [
  { key: 'product', label: 'Product & Issue', shortLabel: 'Product' },
  { key: 'customer', label: 'Customer Info', shortLabel: 'Customer' },
  { key: 'agreement', label: 'Review & Sign', shortLabel: 'Sign' },
];

// ─── Slide variants ─────────────────────────────────────────────────────────

const stepVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? '60%' : '-60%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? '-60%' : '60%',
    opacity: 0,
  }),
};

const stepTransition = {
  x: { type: 'spring' as const, damping: 30, stiffness: 320, mass: 0.6 },
  opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as readonly number[] },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileRepairIntakeForm({
  onClose,
  onSubmit,
  initialData,
  favoriteSkuId,
}: MobileRepairIntakeFormProps) {
  const [currentStep, setCurrentStep] = useState<FormStep>('product');
  const [slideDir, setSlideDir] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<RepairFormData>(() => buildInitialFormData(initialData));
  const [signatureData, setSignatureData] = useState<SignatureData | null>(null);

  const [techs, setTechs] = useState<TechStaff[]>([]);
  const [loadingTechs, setLoadingTechs] = useState(true);
  const [skuIssues, setSkuIssues] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Load techs ──
  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => { if (active) setTechs(data.filter((m) => m.role === 'technician')); })
      .catch(() => setTechs([]))
      .finally(() => setLoadingTechs(false));
    return () => { active = false; };
  }, []);

  // ── Load SKU issues ──
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

  // ── Sync initialData ──
  useEffect(() => { setFormData(buildInitialFormData(initialData)); }, [initialData]);

  // ── Scroll to top on step change ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentStep]);

  // ── Validation ──
  const productSelected = !!(formData.product.type && formData.product.model);
  const canProceedFromProduct =
    productSelected &&
    (formData.repairReasons.length > 0 || formData.repairNotes.trim().length > 0);
  const canProceedFromCustomer =
    !!(formData.customer.name && formData.customer.phone && formData.serialNumber && formData.price);
  const canSubmit = canProceedFromCustomer && !!signatureData;

  const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

  // ── Navigation ──
  const goNext = useCallback(() => {
    if (currentStep === 'product' && canProceedFromProduct) {
      setSlideDir(1);
      setCurrentStep('customer');
    } else if (currentStep === 'customer' && canProceedFromCustomer) {
      setSlideDir(1);
      setCurrentStep('agreement');
    }
  }, [currentStep, canProceedFromProduct, canProceedFromCustomer]);

  const goBack = useCallback(() => {
    setSlideDir(-1);
    if (currentStep === 'customer') setCurrentStep('product');
    else if (currentStep === 'agreement') setCurrentStep('customer');
  }, [currentStep]);

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
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
  }, [canSubmit, signatureData, formData, onSubmit]);

  // ── Field updaters ──
  const updateCustomer = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, customer: { ...prev.customer, [field]: value } }));
  }, []);

  // ── Toolbar leading: Close button ──
  const toolbarLeading = (
    <button
      onClick={onClose}
      className="h-11 w-11 flex items-center justify-center rounded-xl active:bg-gray-100 transition-colors"
      aria-label="Close"
    >
      <X className="h-5 w-5 text-gray-900" />
    </button>
  );

  // ── Toolbar trailing: Step dots ──
  const toolbarTrailing = (
    <div className="flex items-center gap-1.5 pr-1">
      {STEPS.map((step, i) => (
        <div
          key={step.key}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === currentStepIndex
              ? 'w-5 bg-blue-600'
              : i < currentStepIndex
                ? 'w-2 bg-gray-900'
                : 'w-2 bg-gray-300'
          }`}
        />
      ))}
    </div>
  );

  // ── Bottom dock ──
  const bottomDock = (
    <div className="flex flex-col">
      {/* Signature hint on agreement step */}
      {currentStep === 'agreement' && !signatureData && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200">
          <p className="text-[10px] font-black uppercase tracking-wide text-amber-700 text-center">
            Signature required to submit
          </p>
        </div>
      )}

      <div className="flex" style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}>
        {/* Back button */}
        {currentStep !== 'product' && (
          <button
            onClick={goBack}
            className="flex items-center justify-center gap-2 px-6 h-16 border-r border-gray-200 text-xs font-black uppercase tracking-wide text-gray-600 active:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        )}

        {/* Primary action */}
        {currentStep === 'agreement' ? (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="flex-1 flex items-center justify-center gap-2.5 h-16 bg-emerald-600 active:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black uppercase tracking-wide transition-colors"
          >
            {isSubmitting ? (
              <>
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Submitting...
              </>
            ) : (
              <>
                Submit Repair
                <Check className="h-5 w-5" />
              </>
            )}
          </button>
        ) : (
          <button
            onClick={goNext}
            disabled={
              currentStep === 'product' ? !canProceedFromProduct : !canProceedFromCustomer
            }
            className="flex-1 flex items-center justify-center gap-2.5 h-16 bg-blue-600 active:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black uppercase tracking-wide transition-colors"
          >
            Continue
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <MobileShell
      toolbar={{
        title: 'Repair Intake',
        subtitle: `Step ${currentStepIndex + 1} — ${STEPS[currentStepIndex].label}`,
        leading: toolbarLeading,
        trailing: toolbarTrailing,
      }}
      bottomDock={bottomDock}
      className="bg-gray-50"
    >
      {/* ── Step indicator rail ── */}
      <div className="flex-shrink-0 flex bg-white border-b border-gray-100">
        {STEPS.map((step, i) => {
          const isActive = step.key === currentStep;
          const isDone = i < currentStepIndex;
          return (
            <div
              key={step.key}
              className={`flex-1 flex items-center justify-center gap-2 py-3 border-r last:border-r-0 border-gray-100 transition-colors duration-200 ${
                isActive ? 'bg-blue-600' : isDone ? 'bg-gray-900' : 'bg-white'
              }`}
            >
              {isDone ? (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className={`text-[10px] font-black tabular-nums ${isActive ? 'text-white' : 'text-gray-400'}`}>
                  {i + 1}
                </span>
              )}
              <span className={`text-[10px] font-black uppercase tracking-wider ${
                isActive || isDone ? 'text-white' : 'text-gray-400'
              }`}>
                {step.shortLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Animated step content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait" custom={slideDir}>
          <motion.div
            key={currentStep}
            custom={slideDir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepTransition}
            className="p-5"
          >
            {/* ── STEP 1: Product & Issue ── */}
            {currentStep === 'product' && (
              <div className="space-y-5">
                {/* Product selector */}
                <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                  <ProductSelector
                    onSelect={(product) => setFormData(prev => ({ ...prev, product }))}
                    selectedProduct={formData.product.type ? formData.product : null}
                    onPriceChange={(price) => setFormData(prev => ({ ...prev, price }))}
                  />
                </div>

                {/* Reason + Tech — visible after product selected */}
                {productSelected && (
                  <motion.div
                    initial={framerPresenceMobile.mobileCard.initial}
                    animate={framerPresenceMobile.mobileCard.animate}
                    transition={framerTransitionMobile.mobileCardMount}
                    className="space-y-5"
                  >
                    {/* Reason selector */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                      <ReasonSelector
                        selectedReasons={formData.repairReasons}
                        notes={formData.repairNotes}
                        onReasonsChange={(reasons) => setFormData(prev => ({ ...prev, repairReasons: reasons }))}
                        onNotesChange={(notes) => setFormData(prev => ({ ...prev, repairNotes: notes }))}
                        skuIssues={skuIssues}
                      />
                    </div>

                    {/* Tech assignment */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                          Assignment
                        </p>
                        <label className="block text-xs font-black uppercase tracking-tight text-gray-900">
                          Assign Technician
                          <span className="ml-2 text-[10px] font-bold text-gray-400 normal-case tracking-normal">Optional</span>
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
                        className="w-full px-4 h-14 rounded-xl border border-gray-200 bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all disabled:opacity-50"
                      >
                        <option value="">— Unassigned —</option>
                        {techs.map(tech => (
                          <option key={tech.id} value={tech.id}>{tech.name}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* ── STEP 2: Customer Info ── */}
            {currentStep === 'customer' && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <div className="mb-5 pb-4 border-b border-gray-100">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">
                    Step 2
                  </p>
                  <h3 className="text-base font-black uppercase tracking-tight text-gray-900">
                    Customer Information
                  </h3>
                </div>
                <MobileCustomerInfoForm
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

            {/* ── STEP 3: Agreement & Signature ── */}
            {currentStep === 'agreement' && (
              <MobileRepairAgreement
                formData={formData}
                signatureData={signatureData}
                onSignatureChange={setSignatureData}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </MobileShell>
  );
}
