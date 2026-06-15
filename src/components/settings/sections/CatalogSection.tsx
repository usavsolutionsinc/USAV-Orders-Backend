'use client';

import { CatalogManagerList } from '@/components/receiving/workspace/line-edit/CatalogManagerList';
import { PlatformAccountsManager } from '@/components/receiving/workspace/line-edit/PlatformAccountsManager';

/**
 * Settings → Platforms & Types. Full-page home for the org platform / storefront
 * account / receiving-type catalog (the same lists the label editor's pencil
 * manages, surfaced as a dedicated settings area, plus accounts + type bindings
 * which the compact popover omits). Gated by `admin.manage_features` via the
 * settings sidebar registry; the write endpoints enforce the same permission.
 */
export function CatalogSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Platforms &amp; Types</h2>
        <p className="mt-1 text-sm text-gray-500">
          The sales channels, storefront accounts, and receiving flow types your team picks from
          across receiving and orders. Add, rename, reorder, hide, or delete your own — built-in
          defaults are protected (hide-only, restorable).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Platforms</h3>
        <CatalogManagerList kind="platform" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Storefront accounts</h3>
        <p className="mb-3 text-xs text-gray-500">
          The specific stores under each platform (e.g. your eBay accounts). A flow type can pin one
          so it resolves the right integration.
        </p>
        <PlatformAccountsManager />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Receiving types</h3>
        <p className="mb-3 text-xs text-gray-500">
          Use the <span className="font-semibold">gear</span> on a type to bind it to a storefront
          account or a custom workflow node (e.g. your own repair-service flow).
        </p>
        <CatalogManagerList kind="type" enableTypeBindings />
      </div>
    </div>
  );
}
