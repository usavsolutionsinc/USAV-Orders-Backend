'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Mail, MapPin, Copy, Check } from '@/components/Icons';
import { sectionLabel, fieldLabel, dataValue } from '@/design-system/tokens/typography/presets';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';

interface CustomerRecord {
  id: number;
  display_name: string | null;
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  shipping_address_1: string | null;
  shipping_address_2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  created_at: string | null;
}

interface CustomerDetailsTabProps {
  customerId?: number | null;
}

function fullName(c: CustomerRecord): string {
  return (
    c.display_name || c.customer_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || ''
  ).trim();
}

function addressLines(c: CustomerRecord): string[] {
  const street = [c.shipping_address_1, c.shipping_address_2].filter(Boolean).join(', ');
  const cityLine = [c.shipping_city, c.shipping_state, c.shipping_postal_code].filter(Boolean).join(' ');
  return [street, cityLine, c.shipping_country || ''].map((s) => s.trim()).filter(Boolean);
}

export function CustomerDetailsTab({ customerId }: CustomerDetailsTabProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error('Failed to load customer');
      const json = await res.json();
      return json.customer as CustomerRecord;
    },
  });

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const field = (key: string, label: string, value: string, icon?: ReactNode) => (
    <HoverTooltip label="Click to copy" asChild>
      <Button
        type="button"
        variant="ghost"
        onClick={() => copy(key, value)}
        className="flex w-full items-start justify-start gap-3 rounded-none px-4 py-3 text-left font-normal hover:bg-surface-hover"
      >
        <span className="mt-1 w-3.5 shrink-0 text-text-faint">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block ${fieldLabel} text-text-soft`}>{label}</span>
          <span className={`mt-0.5 block whitespace-pre-line break-words ${dataValue}`}>{value}</span>
        </span>
        {copied === key ? (
          <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        ) : (
          <Copy className="mt-1 h-3.5 w-3.5 shrink-0 text-text-faint" />
        )}
      </Button>
    </HoverTooltip>
  );

  if (!customerId) {
    return (
      <section className="mx-8">
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas/60 px-4 py-8 text-center">
          <User className="mx-auto mb-2 h-5 w-5 text-text-faint" />
          <p className={`${fieldLabel} text-text-faint`}>No customer linked</p>
          <p className="mt-1 text-xs font-medium text-text-faint">
            MFN Amazon orders attach a shipping contact once the PII role is approved.
          </p>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="mx-8">
        <div className="h-32 animate-pulse rounded-xl bg-surface-sunken" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="mx-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-xs font-bold text-red-600">
          Failed to load customer.
        </div>
      </section>
    );
  }

  const name = fullName(data);
  const phone = data.phone || data.mobile || '';
  const lines = addressLines(data);
  const fullAddress = [name, ...lines].filter(Boolean).join('\n');
  const hasAnything = !!name || !!data.email || !!phone || lines.length > 0;

  return (
    <section className="mx-8 space-y-3">
      <div className="divide-y divide-border-hairline overflow-hidden rounded-xl border border-border-soft bg-surface-card">
        {name && field('name', 'Name', name, <User className="h-3.5 w-3.5" />)}
        {data.email && field('email', 'Email', data.email, <Mail className="h-3.5 w-3.5" />)}
        {phone && field('phone', 'Phone', phone)}
        {lines.length > 0 && field('address', 'Shipping address', lines.join('\n'), <MapPin className="h-3.5 w-3.5" />)}
      </div>

      {lines.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => copy('full', fullAddress)}
          icon={copied === 'full' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          className={`w-full rounded-xl border border-border-soft bg-surface-card py-2 ring-0 ${sectionLabel} text-text-muted hover:bg-surface-hover`}
        >
          {copied === 'full' ? 'Copied' : 'Copy full address'}
        </Button>
      )}

      {!hasAnything && (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas/60 px-4 py-6 text-center text-xs font-bold text-text-faint">
          Customer linked, but no contact details captured yet.
        </div>
      )}
    </section>
  );
}
