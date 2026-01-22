// RepairServiceForm.tsx
import React from 'react'

type RepairServiceFormProps = {
  ticketNumber: string | number
  productTitle: string
  issue: string
  serialNumber: string
  name: string
  contact: string
  price: string
  startDateTime: string
}

const RepairServiceForm: React.FC<RepairServiceFormProps> = ({
  ticketNumber,
  productTitle,
  issue,
  serialNumber,
  name,
  contact,
  price,
  startDateTime
}) => {
  return (
    <div className="w-[8.5in] min-h-[11in] mx-auto bg-white text-black p-8 print:p-6">
      {/* Header */}
      <h1 className="text-[22px] font-semibold mb-4">Repair Service</h1>

      {/* RS # */}
      <div className="mb-3 text-[14px]">
        <span className="font-semibold">RS #:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5">
          {ticketNumber}
        </span>
      </div>

      {/* Spacer */}
      <div className="h-3" />

      {/* Product */}
      <div className="mb-3 text-[14px]">
        <span className="font-semibold">Product:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5">
          {productTitle}
        </span>
      </div>

      {/* Issue */}
      <div className="mb-1 text-[14px]">
        <span className="font-semibold">Issue:</span>
      </div>
      <div className="border border-black min-h-[80px] px-2 py-1 text-[14px] whitespace-pre-wrap">
        {issue}
      </div>

      {/* Serial # */}
      <div className="h-3" />
      <div className="mb-3 text-[14px]">
        <span className="font-semibold">Serial #</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5">
          {serialNumber}
        </span>
      </div>

      {/* Name */}
      <div className="mb-3 text-[14px]">
        <span className="font-semibold">Name:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5">
          {name}
        </span>
      </div>

      {/* Contact */}
      <div className="mb-3 text-[14px]">
        <span className="font-semibold">Contact:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5">
          {contact}
        </span>
      </div>

      {/* Spacer */}
      <div className="h-3" />

      {/* Price */}
      <div className="mb-3 text-[14px]">
        <span className="inline-block min-w-[250px] border-b border-black px-1 pb-0.5">
          {price}
        </span>
        <span> - Price Paid at Pick-up</span>
      </div>

      {/* Info text */}
      <div className="h-3" />
      <p className="text-[12px] leading-snug mb-2">
        Your Bose product has been received into our repair center. Under normal
        circumstances it will be repaired within the next 3–10 working days and
        returned to you at the address above.
      </p>
      <p className="text-[12px] leading-snug mb-6">
        There is a 30 day Warranty on all our repair services.
      </p>

      {/* Drop Off */}
      <div className="h-3" />
      <div className="mb-2 text-[14px]">
        Drop Off X{' '}
        <span className="inline-block w-[260px] border-b border-black align-middle" />{' '}
        Date:{' '}
        <span className="inline-block min-w-[160px] border-b border-black px-1 pb-0.5 align-middle">
          {startDateTime}
        </span>
      </div>
      <p className="text-[12px] leading-snug mb-8">
        By signing above you agree to the listed price and any unexpected delays in the
        repair process.
      </p>

      {/* Repaired / Who / Date (blank in this version) */}
      <div className="mb-6 text-[14px]">
        <span className="font-semibold">Repaired:</span>
      </div>

      <div className="mb-3 text-[14px]">
        <span className="font-semibold">Who:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5" />
      </div>
      <div className="mb-8 text-[14px]">
        <span className="font-semibold">Date:</span>
        <span className="inline-block min-w-[250px] border-b border-black ml-2 px-1 pb-0.5" />
      </div>

      {/* Pick Up */}
      <div className="mb-4 text-[14px]">
        Pick Up X{' '}
        <span className="inline-block w-[260px] border-b border-black align-middle" />{' '}
        Date: ____/_____/_____
      </div>

      {/* Footer */}
      <p className="text-[12px] leading-snug">Enjoy your repaired unit!</p>
    </div>
  )
}

export default RepairServiceForm
