'use client'

import React from 'react'
import { formatRepairPaperTicketNumber } from '@/lib/repair/repair-paper-ticket'
import { RepairPaperTicketHeading } from './RepairPaperTicketHeading'
import type { RepairReceiptProps } from '@/lib/repair/repair-intake-receipt'
import { REPAIR_PICKUP_DATE_PLACEHOLDER } from '@/lib/repair/repair-paper-html'
import { useAuth } from '@/contexts/AuthContext'

export type RepairServiceFormProps = RepairReceiptProps & {
  /** `compact` — review-step preview: drop-off only, full column width. */
  density?: 'full' | 'compact';
  /** `screen` — content-height on-screen preview; `print` — letter min-height. */
  surface?: 'screen' | 'print';
};

function RepairSignatureLine({
  label,
  dateText,
}: {
  label: string;
  dateText: string;
}) {
  return (
    <div className="mb-2 grid grid-cols-[5.75rem_minmax(0,1fr)_11rem] items-end gap-x-4">
      <span className="whitespace-nowrap font-bold">{label}</span>
      {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
      <div className="border-b border-black" style={{ height: '24px' }} />
      <span className="whitespace-nowrap text-right font-bold tabular-nums">{dateText}</span>
    </div>
  );
}

const RepairServiceForm: React.FC<RepairServiceFormProps> = ({
  ticketNumber,
  productTitle,
  issue,
  serialNumber,
  name,
  contact,
  price,
  startDateTime,
  density = 'full',
  surface = 'screen',
}) => {
  const displayTicket = formatRepairPaperTicketNumber(ticketNumber)
  const isCompact = density === 'compact'
  const isScreen = surface === 'screen'
  // On-screen preview only — the actual printed form (/api/repair-service/print/[id])
  // is the source of truth and pulls the full letterhead (address + phone) from
  // org settings. This preview only has the org name available client-side.
  const { user } = useAuth()
  const orgName = user?.organizationName || 'Workspace'

  // Format contact display as "Name, Phone, Email"
  const contactDisplay = [name, contact].filter(Boolean).join(', ')

  const headerGap = isCompact ? 'mb-3' : isScreen ? 'mb-5' : 'mb-8'
  const sectionGap = isCompact ? 'mb-3' : isScreen ? 'mb-4' : 'mb-6'
  const termsGap = isCompact ? 'mb-3' : isScreen ? 'mb-3' : 'mb-4 print:mb-2'
  const dropOffGap = isCompact ? 'mb-0 mt-3' : isScreen ? 'mb-2 mt-3' : 'mb-4 mt-4 print:mb-3 print:mt-2'
  const pickupGap = isScreen ? 'mt-4' : 'mt-6 print:mt-6'
  const pickupClosingGap = isScreen ? 'mt-3' : 'mt-6'

  return (
    <div
      className={
        isCompact
          ? 'w-full bg-surface-card px-4 py-3 font-sans text-text-default'
          : isScreen
            ? 'mx-auto w-[8.5in] max-w-full bg-surface-card p-6 font-sans text-text-default'
            : 'mx-auto min-h-[11in] w-[8.5in] bg-surface-card p-8 font-sans text-text-default print:p-6'
      }
    >

      {/* Header Section */}
      <div className={`${headerGap} text-right`}>
        <h2 className={isCompact ? 'text-sm font-bold' : 'text-lg font-bold'}>{orgName}</h2>
        <p className="text-xs sm:text-sm">16161 Gothard St. Suite A</p>
        <p className="text-xs sm:text-sm">Huntington Beach, CA 92647, United States</p>
        <p className="text-xs sm:text-sm">Tel: (714) 596-6888</p>
      </div>

      <RepairPaperTicketHeading displayTicket={displayTicket} compact={isCompact} />

      {/* Information Table */}
      {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
      <div className={`border-l border-t border-black ${sectionGap} ${isCompact ? 'text-xs' : ''}`}>
        {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
        <div className="flex border-b border-r border-black">
          {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
          <div className={`shrink-0 border-r border-black bg-surface-canvas p-2 font-bold ${isCompact ? 'w-28' : 'w-40'}`}>Product Title:</div>
          <div className="min-w-0 flex-1 break-words p-2">{productTitle}</div>
        </div>
        {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
        <div className="flex border-b border-r border-black">
          {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
          <div className={`shrink-0 border-r border-black bg-surface-canvas p-2 font-bold ${isCompact ? 'w-28' : 'w-40'}`}>SN & Issues:</div>
          <div className="min-w-0 flex-1 break-words p-2">{serialNumber}, {issue}</div>
        </div>
        {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
        <div className="flex border-b border-r border-black">
          {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
          <div className={`shrink-0 border-r border-black bg-surface-canvas p-2 font-bold ${isCompact ? 'w-28' : 'w-40'}`}>Contact Info:</div>
          <div className="min-w-0 flex-1 break-words p-2">{contactDisplay}</div>
        </div>
      </div>

      {/* Price Section */}
      <div className={sectionGap}>
        <p className={`mb-2 font-medium ${isCompact ? 'text-sm' : 'text-lg'}`}>
          <span className="font-bold text-emerald-600">${price}</span> - Price Paid at Pick-up
        </p>
        <p className={isCompact ? 'text-xs font-medium' : 'text-base font-medium'}>
          Card / Cash - Payment Method
        </p>
      </div>

      {/* Terms & Warranty */}
      <div className={`text-sm leading-relaxed ${termsGap} ${isCompact ? 'text-xs' : ''}`}>
        <p className={isCompact ? 'mb-2' : isScreen ? 'mb-2' : 'mb-3 print:mb-2'}>
          Your Bose product has been received into our repair center. Under normal circumstances it will
          be repaired within the next 3-10 working days and returned to you at the address above.
        </p>
        {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
        <p className="inline-block border-b border-black font-bold">
          There is a 30 day Warranty on all our repair services.
        </p>
      </div>

      {/* Drop Off Section */}
      <div className={dropOffGap}>
        <RepairSignatureLine label="Drop Off X" dateText={`Date: ${startDateTime}`} />
        <p className="text-xs italic">
          By signing above you agree to the listed price and any unexpected delays in the repair process.
        </p>
      </div>

      {!isCompact && (
        <>
          {/* Internal Use Table */}
          {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
          <div className={`flex border-l border-t border-black ${isScreen ? 'mb-2' : 'mb-4 print:mb-3'}`}>
            {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
            <div className="flex-1 border-b border-r border-black p-2 font-bold">Part Repaired:</div>
            {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
            <div className="flex-1 border-b border-r border-black p-2" />
            {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
            <div className="flex-1 border-b border-r border-black p-2 font-bold">Who:</div>
            {/* ds-allow-raw-neutral: print ink — literal black-on-white output */}
            <div className="flex-1 border-b border-r border-black p-2 font-bold">Date:</div>
          </div>

          {/* Pick Up Section */}
          <div className={pickupGap}>
            <RepairSignatureLine label="Pick Up X" dateText={REPAIR_PICKUP_DATE_PLACEHOLDER} />
            <p className={`text-center text-xl font-bold ${pickupClosingGap}`}>Enjoy your repaired unit!</p>
          </div>
        </>
      )}

    </div>
  )
}

export default RepairServiceForm
