'use server';

import { redirect } from 'next/navigation';

/** Server action: redirect to the per-unit timeline page on form submit. */
export async function lookupUnit(formData: FormData): Promise<void> {
  const ref = String(formData.get('ref') ?? '').trim();
  if (ref) redirect(`/admin/inventory/units/${encodeURIComponent(ref)}`);
  redirect('/admin/inventory');
}

/** Server action: redirect to the SKU detail page on form submit. */
export async function lookupSku(formData: FormData): Promise<void> {
  const sku = String(formData.get('sku') ?? '').trim();
  if (sku) redirect(`/admin/inventory/sku/${encodeURIComponent(sku)}`);
  redirect('/admin/inventory');
}
