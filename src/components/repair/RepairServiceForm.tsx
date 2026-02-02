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
  // Format contact display as "Name, Phone, Email"
  const contactDisplay = [name, contact].filter(Boolean).join(', ')
  
  return (
    <div className="w-[8.5in] min-h-[11in] mx-auto bg-white text-gray-900 font-sans p-8 print:p-6">
      
      {/* Header Section */}
      <div className="text-right mb-8">
        <h2 className="font-bold text-lg">USAV Solutions</h2>
        <p className="text-sm">16161 Gothard St. Suite A</p>
        <p className="text-sm">Huntington Beach, CA 92647, United States</p>
        <p className="text-sm">Tel: (714) 596-6888</p>
      </div>

      {/* Title and Ticket Number */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Repair Service</h1>
        <p className="text-lg font-semibold">{ticketNumber} - Repair Ticket Number</p>
      </div>

      {/* Information Table */}
      <div className="border-t border-l border-black mb-6">
        <div className="flex border-b border-r border-black">
          <div className="w-40 p-2 font-bold bg-gray-50 border-r border-black">Product Title:</div>
          <div className="flex-1 p-2">{productTitle}</div>
        </div>
        <div className="flex border-b border-r border-black">
          <div className="w-40 p-2 font-bold bg-gray-50 border-r border-black">SN & Issues:</div>
          <div className="flex-1 p-2">{serialNumber}, {issue}</div>
        </div>
        <div className="flex border-b border-r border-black">
          <div className="w-40 p-2 font-bold bg-gray-50 border-r border-black">Contact Info:</div>
          <div className="flex-1 p-2">{contactDisplay}</div>
        </div>
      </div>

      {/* Price Section */}
      <div className="mb-6">
        <p className="text-lg font-medium mb-2">
          <span className="font-bold">${price}</span> - Price Paid at Pick-up
        </p>
        <p className="text-base font-medium">
          Card / Cash - Payment Method
        </p>
      </div>

      {/* Terms & Warranty */}
      <div className="mb-10 text-sm leading-relaxed">
        <p className="mb-4">
          Your Bose product has been received into our repair center. Under normal circumstances it will 
          be repaired within the next 3-10 working days and returned to you at the address above.
        </p>
        <p className="font-bold border-b border-black inline-block">
          There is a 30 day Warranty on all our repair services.
        </p>
      </div>

      {/* Drop Off Section */}
      <div className="mb-10 mt-28">
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
      <div className="border-t border-l border-black mb-10 flex">
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Part Repaired:</div>
        <div className="flex-1 border-r border-b border-black p-2"></div>
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Who:</div>
        <div className="flex-1 border-r border-b border-black p-2 font-bold">Date:</div>
      </div>

      {/* Pick Up Section */}
      <div className="mt-32">
        <div className="flex items-end gap-4 mb-4">
          <span className="font-bold whitespace-nowrap">Pick Up X</span>
          <div className="flex-1 border-b border-black" style={{ height: '24px' }}></div>
          <span className="font-bold whitespace-nowrap">Date: ____ / ____ / ________</span>
        </div>
        <p className="text-center font-bold text-xl mt-8">Enjoy your repaired unit!</p>
      </div>

    </div>
  )
}

export default RepairServiceForm
