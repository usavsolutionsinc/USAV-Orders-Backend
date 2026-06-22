'use client'

import React from 'react'

type RepairServiceFormProps = {
  repairServiceId: string | number
  ticketNumber?: string | number
  productTitle: string
  issue: string
  serialNumber: string
  name: string
  contact: string
  price: string
  startDateTime: string
  /** `print` = letter-size sheet; `preview` = fluid width for on-screen review. */
  variant?: 'print' | 'preview'
}

const RepairServiceForm: React.FC<RepairServiceFormProps> = ({
  repairServiceId,
  ticketNumber,
  productTitle,
  issue,
  serialNumber,
  name,
  contact,
  price,
  startDateTime,
  variant = 'print',
}) => {
  const repairNumericId = Number(String(repairServiceId || '').trim())
  const repairServiceCode = Number.isFinite(repairNumericId) && repairNumericId > 0
    ? `RS-${repairNumericId}`
    : `RS-${String(repairServiceId || '').trim()}`

  // Format contact display as "Name, Phone, Email"
  const contactDisplay = [name, contact].filter(Boolean).join(', ')
  const externalTicket = String(ticketNumber || '').trim()
  const isPreview = variant === 'preview'
  const sheetClass = isPreview
    ? 'w-full bg-white text-gray-900 font-sans p-4 sm:p-6'
    : 'w-[8.5in] min-h-[11in] mx-auto bg-white text-gray-900 font-sans p-8 print:p-6'
  
  return (
    <div className={sheetClass}>
      
      {/* Header Section */}
      <div className={`text-right ${isPreview ? 'mb-4' : 'mb-8'}`}>
        <h2 className={`font-bold ${isPreview ? 'text-base' : 'text-lg'}`}>USAV Solutions</h2>
        <p className="text-sm">16161 Gothard St. Suite A</p>
        <p className="text-sm">Huntington Beach, CA 92647, United States</p>
        <p className="text-sm">Tel: (714) 596-6888</p>
      </div>

      {/* Title and Ticket Number */}
      <div className="mb-6 min-w-0">
        <h1 className={`font-bold mb-2 ${isPreview ? 'text-xl sm:text-2xl' : 'text-3xl'}`}>Repair Service</h1>
        <p className={`font-semibold ${isPreview ? 'text-sm sm:text-base' : 'text-lg'}`}>{repairServiceCode} - Repair Ticket Number</p>
        {externalTicket && !/^RS-\d+$/i.test(externalTicket) && (
          <p className="text-sm font-medium text-gray-600">Ticket #: {externalTicket}</p>
        )}
      </div>

      {/* Information Table */}
      <div className={`border-t border-l border-black ${isPreview ? 'mb-4 text-sm' : 'mb-6'}`}>
        <div className="flex border-b border-r border-black">
          <div className={`p-2 font-bold bg-gray-50 border-r border-black shrink-0 ${isPreview ? 'w-28 sm:w-32' : 'w-40'}`}>Product Title:</div>
          <div className="flex-1 p-2 min-w-0 break-words">{productTitle}</div>
        </div>
        <div className="flex border-b border-r border-black">
          <div className={`p-2 font-bold bg-gray-50 border-r border-black shrink-0 ${isPreview ? 'w-28 sm:w-32' : 'w-40'}`}>SN & Issues:</div>
          <div className="flex-1 p-2 min-w-0 break-words">{serialNumber}, {issue}</div>
        </div>
        <div className="flex border-b border-r border-black">
          <div className={`p-2 font-bold bg-gray-50 border-r border-black shrink-0 ${isPreview ? 'w-28 sm:w-32' : 'w-40'}`}>Contact Info:</div>
          <div className="flex-1 p-2 min-w-0 break-words">{contactDisplay}</div>
        </div>
      </div>

      {/* Price Section */}
      <div className={isPreview ? 'mb-4' : 'mb-6'}>
        <p className={`font-medium mb-2 ${isPreview ? 'text-base' : 'text-lg'}`}>
          <span className="font-bold text-emerald-600">${price}</span> - Price Paid at Pick-up
        </p>
        <p className={`font-medium ${isPreview ? 'text-sm' : 'text-base'}`}>
          Card / Cash - Payment Method
        </p>
      </div>

      {/* Terms & Warranty */}
      <div className={`text-sm leading-relaxed ${isPreview ? 'mb-6' : 'mb-10'}`}>
        <p className="mb-4">
          Your Bose product has been received into our repair center. Under normal circumstances it will 
          be repaired within the next 3-10 working days and returned to you at the address above.
        </p>
        <p className="font-bold border-b border-black inline-block">
          There is a 30 day Warranty on all our repair services.
        </p>
      </div>

      {/* Drop Off Section */}
      <div className={isPreview ? 'mb-6 mt-6' : 'mb-10 mt-28'}>
        <div className="flex items-end gap-4 mb-2">
          <span className="font-bold whitespace-nowrap">Drop Off X</span>
          <div className="flex-1 border-b border-black" style={{ height: '24px' }}></div>
          <span className="font-bold whitespace-nowrap">Date: {startDateTime}</span>
        </div>
        <p className="text-xs italic">
          By signing above you agree to the listed price and any unexpected delays in the repair process.
        </p>
      </div>

      {/* Internal Use Table */}
      <div className={`border-t border-l border-black flex ${isPreview ? 'mb-6 text-xs sm:text-sm' : 'mb-10'}`}>
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Part Repaired:</div>
        <div className="flex-1 border-r border-b border-black p-2"></div>
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Who:</div>
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Date:</div>
      </div>

      {/* Pick Up Section — omitted in preview; customer signs electronically below. */}
      {!isPreview ? (
      <div className="mt-32">
        <div className="flex items-end gap-4 mb-4">
          <span className="font-bold whitespace-nowrap">Pick Up X</span>
          <div className="flex-1 border-b border-black" style={{ height: '24px' }}></div>
          <span className="font-bold whitespace-nowrap">Date: ____ / ____ / ________</span>
        </div>
        <p className="text-center font-bold text-xl mt-8">Enjoy your repaired unit!</p>
      </div>
      ) : null}

    </div>
  )
}

export default RepairServiceForm
