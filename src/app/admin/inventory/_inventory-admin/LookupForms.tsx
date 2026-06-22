import { lookupUnit, lookupSku } from './inventory-admin-actions';

/** Side-by-side Unit / SKU lookup forms (server actions redirect on submit). */
export function LookupForms() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <form action={lookupUnit} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <label htmlFor="ref" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Unit
        </label>
        <input
          id="ref"
          name="ref"
          type="text"
          placeholder="serial or id"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          Timeline →
        </button>
      </form>

      <form action={lookupSku} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <label htmlFor="sku" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          SKU
        </label>
        <input
          id="sku"
          name="sku"
          type="text"
          placeholder="SKU code"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          Detail →
        </button>
      </form>
    </div>
  );
}
