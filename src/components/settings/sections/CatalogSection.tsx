'use client';

import { CatalogManagerList } from '@/components/receiving/workspace/line-edit/CatalogManagerList';

/**
 * Settings → Platforms & Types. Full-page home for the org platform / receiving
 * type catalog (the same lists the label editor's pencil manages, surfaced as a
 * dedicated settings area). Gated by `admin.manage_features` via the settings
 * sidebar registry; the write endpoints enforce the same permission.
 */
export function CatalogSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Platforms &amp; Types</h2>
        <p className="mt-1 text-sm text-gray-500">
          The sales channels and receiving flow types your team picks from across receiving. Add,
          rename, reorder, hide, or delete your own — built-in defaults are protected (hide-only,
          restorable).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Platforms</h3>
        <CatalogManagerList kind="platform" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Receiving types</h3>
        <CatalogManagerList kind="type" />
      </div>
    </div>
  );
}
