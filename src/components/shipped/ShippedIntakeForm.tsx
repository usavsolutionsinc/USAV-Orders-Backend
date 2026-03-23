'use client';

import React, { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, Lock, Check, AlertCircle } from '../Icons';
import { TabSwitch } from '../ui/TabSwitch';
import {
  SidebarIntakeFormField,
  SidebarIntakeFormShell,
  SIDEBAR_INTAKE_INPUT_CLASS,
  SIDEBAR_INTAKE_INPUT_MONO_CLASS,
  SIDEBAR_INTAKE_SELECT_CLASS,
  SIDEBAR_INTAKE_SUBMIT_BUTTON_CLASS,
} from '@/design-system/components';

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
  const router = useRouter();
  const pathname = usePathname();

  const handleClose = useCallback(() => {
    try {
      onClose();
    } catch {
      /* parent close should not block URL cleanup */
    }
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('new')) return;
    params.delete('new');
    const path = pathname || window.location.pathname || '/dashboard';
    const qs = params.toString();
    router.replace(qs ? `${path}?${qs}` : path);
  }, [onClose, pathname, router]);

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

  const productTitleClassName = isProductTitleLocked
    ? 'w-full px-4 py-3 border rounded-xl text-sm font-semibold bg-green-50 border-green-300 text-green-900 cursor-not-allowed focus:outline-none'
    : SIDEBAR_INTAKE_INPUT_CLASS;

  return (
    <SidebarIntakeFormShell
      title="New Order Entry"
      subtitle="Order Information"
      subtitleAccent="green"
      onClose={handleClose}
      bandBelowHeader={
        <TabSwitch
          tabs={[
            { id: 'replacement', label: 'Replacement', color: 'blue' },
            { id: 'add_order', label: 'Add Order', color: 'emerald' },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab as 'replacement' | 'add_order')}
        />
      }
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={(activeTab === 'replacement' ? !canSubmitReplacement : !canSubmitAddOrder) || isSubmitting}
          className={SIDEBAR_INTAKE_SUBMIT_BUTTON_CLASS}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </span>
          ) : activeTab === 'replacement' ? (
            'Submit Order'
          ) : (
            'Add Order'
          )}
        </button>
      }
    >
      {activeTab === 'replacement' ? (
        <>
          <SidebarIntakeFormField label="Order ID" required>
            <>
              <input
                type="text"
                value={replacementData.order_id}
                onChange={(e) => handleOrderIdChange(e.target.value)}
                onBlur={handleOrderIdBlur}
                placeholder="Enter order ID..."
                className={SIDEBAR_INTAKE_INPUT_CLASS}
              />
              {lookupStatus !== 'idle' ? (
                <div className="flex items-center gap-2 text-xs">
                  {lookupStatus === 'searching' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      <span className="font-bold text-blue-600">Searching...</span>
                    </>
                  ) : null}
                  {lookupStatus === 'found' ? (
                    <>
                      <Check className="h-3 w-3 text-green-600" />
                      <span className="font-bold text-green-600">Order found! Product title auto-filled.</span>
                    </>
                  ) : null}
                  {lookupStatus === 'not-found' ? (
                    <>
                      <AlertCircle className="h-3 w-3 text-amber-600" />
                      <span className="font-bold text-amber-600">
                        Order not found. Please enter product title manually.
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Shipping Tracking Number" required>
            <input
              type="text"
              value={replacementData.shipping_tracking_number}
              onChange={(e) =>
                setReplacementData((prev) => ({ ...prev, shipping_tracking_number: e.target.value }))
              }
              placeholder="Enter tracking number..."
              className={SIDEBAR_INTAKE_INPUT_MONO_CLASS}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField
            label="Reason or Ticket #"
            required
            hintBelow={
              <p className="text-[9px] font-medium text-gray-500">
                Will be saved as:{' '}
                <span className="font-bold">
                  {replacementData.reason || '[Reason]'} - {replacementData.product_title || '[Product Title]'}
                </span>
              </p>
            }
          >
            <input
              type="text"
              value={replacementData.reason}
              onChange={(e) => setReplacementData((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Reason for shipment..."
              className={SIDEBAR_INTAKE_INPUT_CLASS}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField
            label={
              <>
                Product Title
                {isProductTitleLocked ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-green-600">
                    <Lock className="h-3 w-3" />
                    <span className="text-[8px]">Locked</span>
                  </span>
                ) : null}
              </>
            }
            required
            hintBelow={
              isProductTitleLocked ? (
                <p className="text-[9px] font-medium text-green-600">
                  This field is locked because the order ID was found in the database.
                </p>
              ) : null
            }
          >
            <input
              type="text"
              value={replacementData.product_title}
              onChange={(e) => setReplacementData((prev) => ({ ...prev, product_title: e.target.value }))}
              placeholder={isProductTitleLocked ? 'Auto-filled from order lookup' : 'Enter product title...'}
              readOnly={isProductTitleLocked}
              disabled={isProductTitleLocked}
              className={productTitleClassName}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Condition" required>
            <select
              value={replacementData.condition}
              onChange={(e) => setReplacementData((prev) => ({ ...prev, condition: e.target.value }))}
              className={SIDEBAR_INTAKE_SELECT_CLASS}
            >
              <option value="Used">Used</option>
              <option value="New">New</option>
              <option value="Parts">Parts</option>
            </select>
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="SKU" optionalHint="(Optional)">
            <input
              type="text"
              value={replacementData.sku}
              onChange={(e) => setReplacementData((prev) => ({ ...prev, sku: e.target.value }))}
              placeholder="Enter SKU..."
              className={SIDEBAR_INTAKE_INPUT_MONO_CLASS}
            />
          </SidebarIntakeFormField>
        </>
      ) : (
        <>
          <SidebarIntakeFormField label="Order ID" required>
            <input
              type="text"
              value={addOrderData.order_id}
              onChange={(e) => setAddOrderData((prev) => ({ ...prev, order_id: e.target.value }))}
              placeholder="Enter order ID..."
              className={SIDEBAR_INTAKE_INPUT_CLASS}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Shipping Tracking Number" required>
            <input
              type="text"
              value={addOrderData.shipping_tracking_number}
              onChange={(e) =>
                setAddOrderData((prev) => ({ ...prev, shipping_tracking_number: e.target.value }))
              }
              placeholder="Enter tracking number..."
              className={SIDEBAR_INTAKE_INPUT_MONO_CLASS}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Product Title" required>
            <input
              type="text"
              value={addOrderData.product_title}
              onChange={(e) => setAddOrderData((prev) => ({ ...prev, product_title: e.target.value }))}
              placeholder="Enter product title..."
              className={SIDEBAR_INTAKE_INPUT_CLASS}
            />
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="Condition" required>
            <select
              value={addOrderData.condition}
              onChange={(e) => setAddOrderData((prev) => ({ ...prev, condition: e.target.value }))}
              className={SIDEBAR_INTAKE_SELECT_CLASS}
            >
              <option value="Used">Used</option>
              <option value="New">New</option>
              <option value="Parts">Parts</option>
            </select>
          </SidebarIntakeFormField>

          <SidebarIntakeFormField label="SKU" optionalHint="(Optional)">
            <input
              type="text"
              value={addOrderData.sku}
              onChange={(e) => setAddOrderData((prev) => ({ ...prev, sku: e.target.value }))}
              placeholder="Enter SKU..."
              className={SIDEBAR_INTAKE_INPUT_MONO_CLASS}
            />
          </SidebarIntakeFormField>
        </>
      )}
    </SidebarIntakeFormShell>
  );
}
