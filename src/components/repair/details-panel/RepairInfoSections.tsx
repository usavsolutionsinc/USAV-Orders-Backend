'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { formatPhoneNumber } from '@/utils/phone';

function getContactParts(contactInfo: string | null | undefined) {
  if (!contactInfo) return [];
  return contactInfo.split(',').map((part) => part.trim());
}

/** Read-only customer summary block for the repair overview tab. */
export function RepairCustomerSection({ repair }: { repair: RSRecord }) {
  const parts = getContactParts(repair.contact_info);
  const phone = parts[1] || '';
  const email = parts[2] || '';

  return (
    <section>
      <div className="space-y-3">
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Name</span>
          <p className="font-bold text-sm text-text-default">
            {parts[0] || 'Not provided'}
          </p>
        </div>
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Contact</span>
          <div className="space-y-1">
            {!repair.contact_info ? (
              <p className="font-semibold text-sm text-text-default">Not provided</p>
            ) : (
              <>
                {phone ? <p className="font-semibold text-sm text-text-default">{formatPhoneNumber(phone)}</p> : null}
                {email ? <p className="font-semibold text-sm text-text-default lowercase">{email}</p> : null}
                {!phone && !email ? (
                  <p className="font-semibold text-sm text-text-default">{repair.contact_info}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Product(s)</span>
          <p className="font-semibold text-sm text-text-default">{repair.product_title || 'Not provided'}</p>
        </div>
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Price</span>
          <p className="font-bold text-sm text-emerald-600">{repair.price ? `$${repair.price}` : 'Not set'}</p>
        </div>
      </div>
    </section>
  );
}

/** Read-only technical summary block for the repair overview tab. */
export function RepairTechnicalSection({ repair }: { repair: RSRecord }) {
  return (
    <section>
      <div className="space-y-3">
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Issue</span>
          <p className="text-sm text-text-default font-bold leading-relaxed">{repair.issue || 'No issue described'}</p>
        </div>
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Serial Number</span>
          <p className="font-mono text-sm text-text-default font-semibold">{repair.serial_number || 'N/A'}</p>
        </div>
      </div>
    </section>
  );
}

/** Read-only record metadata block for the repair notes/admin tab. */
export function RepairRecordSection({ repair }: { repair: RSRecord }) {
  return (
    <section>
      <div className="space-y-3">
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Created</span>
          <p className="font-semibold text-sm text-text-default">
            {repair.created_at ? new Date(repair.created_at).toLocaleString() : 'Unknown'}
          </p>
        </div>
        <div>
          <span className="text-xs text-text-soft font-semibold block mb-1">Updated</span>
          <p className="font-semibold text-sm text-text-default">
            {repair.updated_at ? new Date(repair.updated_at).toLocaleString() : 'Unknown'}
          </p>
        </div>
      </div>
    </section>
  );
}
