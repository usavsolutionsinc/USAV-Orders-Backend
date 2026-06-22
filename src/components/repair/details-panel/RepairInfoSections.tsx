'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { formatPhoneNumber } from '@/utils/phone';

/** Read-only Customer Information + Technical Details + Record sections. */
export function RepairInfoSections({ repair }: { repair: RSRecord }) {
  return (
    <>
      {/* Customer Information */}
      <section>
        <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
          Customer Information
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Name</span>
            <p className="font-bold text-sm text-gray-900">
              {(() => {
                if (!repair.contact_info) return 'Not provided';
                const parts = repair.contact_info.split(',').map(p => p.trim());
                return parts[0] || 'Not provided';
              })()}
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Contact</span>
            <div className="space-y-1">
              {(() => {
                if (!repair.contact_info) return <p className="font-semibold text-sm text-gray-900">Not provided</p>;
                const parts = repair.contact_info.split(',').map(p => p.trim());
                const phone = parts[1] || '';
                const email = parts[2] || '';

                return (
                  <>
                    {phone && <p className="font-semibold text-sm text-gray-900">{formatPhoneNumber(phone)}</p>}
                    {email && <p className="font-semibold text-sm text-gray-900 lowercase">{email}</p>}
                    {!phone && !email && <p className="font-semibold text-sm text-gray-900">{repair.contact_info}</p>}
                  </>
                );
              })()}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Product(s)</span>
            <p className="font-semibold text-sm text-gray-900">{repair.product_title || 'Not provided'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Price</span>
            <p className="font-bold text-sm text-emerald-600">{repair.price ? `$${repair.price}` : 'Not set'}</p>
          </div>
        </div>
      </section>

      {/* Technical Details */}
      <section>
        <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
          Technical Details
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Issue</span>
            <p className="text-sm text-gray-900 font-bold leading-relaxed">{repair.issue || 'No issue described'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Serial Number</span>
            <p className="font-mono text-sm text-gray-900 font-semibold">{repair.serial_number || 'N/A'}</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
          Record
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Created</span>
            <p className="font-semibold text-sm text-gray-900">
              {repair.created_at ? new Date(repair.created_at).toLocaleString() : 'Unknown'}
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-semibold block mb-1">Updated</span>
            <p className="font-semibold text-sm text-gray-900">
              {repair.updated_at ? new Date(repair.updated_at).toLocaleString() : 'Unknown'}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
