import { Camera, Check, ExternalLink, History, MapPin, Package } from '@/components/Icons';
import { sectionLabel, fieldLabel, dataValue, monoValue } from '@/design-system/tokens/typography/presets';
import { AuditTimeline } from '@/components/audit/AuditTimeline';
import { formatDate, type SkuDetailData } from './sku-detail-types';
import type { SkuDetailController } from './useSkuDetailView';

/** Read-only detail cards: catalog, ecwid, photos, history, ledger, transfers, audit. */
export function SkuDetailCards({ c, data }: { c: SkuDetailController; data: SkuDetailData }) {
  return (
    <>
      {/* Catalog Info */}
      {data.catalog && (
        <div className="rounded-xl bg-surface-card border border-border-soft p-4">
          <h2 className={`${sectionLabel} mb-3`}>Catalog Details</h2>
          <div className="grid grid-cols-2 gap-3">
            {data.catalog.category && (
              <div>
                <p className={fieldLabel}>Category</p>
                <p className={dataValue}>{data.catalog.category}</p>
              </div>
            )}
            {data.catalog.upc && (
              <div>
                <p className={fieldLabel}>UPC</p>
                <button onClick={() => c.handleCopy(data.catalog!.upc!, 'upc')} className={`ds-raw-button ${monoValue} text-caption hover:text-blue-600 transition-colors`}>
                  {data.catalog.upc}
                  {c.copiedField === 'upc' && <Check className="inline h-3 w-3 ml-1 text-emerald-500" />}
                </button>
              </div>
            )}
            {data.catalog.ean && (
              <div>
                <p className={fieldLabel}>EAN</p>
                <p className={monoValue + ' text-caption'}>{data.catalog.ean}</p>
              </div>
            )}
            <div>
              <p className={fieldLabel}>Status</p>
              <span className={`inline-block rounded-full px-2 py-0.5 text-micro font-bold uppercase ${data.catalog.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {data.catalog.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Ecwid Product Info */}
      {data.ecwid && (
        <div className="rounded-xl bg-surface-card border border-border-soft p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className={sectionLabel}>Ecwid Product</h2>
            <a
              href={`https://my.ecwid.com/store/${process.env.NEXT_PUBLIC_ECWID_STORE_ID || ''}#product:id=${data.ecwid.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
            >
              Open in Ecwid
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {data.ecwid.description && <p className="text-xs font-medium text-text-muted line-clamp-3">{data.ecwid.description}</p>}
        </div>
      )}

      {/* Packing Photos */}
      <div className="rounded-xl bg-surface-card border border-border-soft p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className={sectionLabel}>
            <Camera className="inline h-3 w-3 mr-1" />
            Photos ({data.photos.length})
          </h2>
        </div>
        {data.photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {data.photos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => c.setLightboxUrl(photo.url)}
                className="ds-raw-button relative aspect-square rounded-lg overflow-hidden bg-surface-sunken hover:ring-2 hover:ring-blue-400 transition-all"
              >
                <img src={photo.url} alt={`SKU photo ${photo.id}`} className="h-full w-full object-cover" loading="lazy" />
                {photo.photoType && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-mini font-bold uppercase text-white">{photo.photoType}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs font-bold text-text-faint">No photos for this SKU</p>
        )}
      </div>

      {/* Serial / Tracking History */}
      <div className="rounded-xl bg-surface-card border border-border-soft p-4">
        <h2 className={`${sectionLabel} mb-3`}>
          <Package className="inline h-3 w-3 mr-1" />
          Inventory History ({data.history.length})
        </h2>
        {data.history.length > 0 ? (
          <div className="space-y-2">
            {data.history.map((row) => (
              <div key={row.id} className="rounded-lg bg-surface-canvas border border-border-hairline p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {row.serial_number && (
                      <button onClick={() => c.handleCopy(row.serial_number!, `serial-${row.id}`)} className="ds-raw-button text-caption font-bold font-mono text-text-default hover:text-blue-600 transition-colors block">
                        SN: {row.serial_number}
                        {c.copiedField === `serial-${row.id}` && <Check className="inline h-3 w-3 ml-1 text-emerald-500" />}
                      </button>
                    )}
                    {row.shipping_tracking_number && (
                      <button onClick={() => c.handleCopy(row.shipping_tracking_number!, `tracking-${row.id}`)} className="ds-raw-button text-caption font-bold font-mono text-text-soft hover:text-blue-600 transition-colors block">
                        Tracking: {row.shipping_tracking_number}
                        {c.copiedField === `tracking-${row.id}` && <Check className="inline h-3 w-3 ml-1 text-emerald-500" />}
                      </button>
                    )}
                    {row.notes && <p className="text-caption font-medium text-text-soft mt-1">{row.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {row.location && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-blue-700">{row.location}</span>
                    )}
                    <p className="text-micro font-bold text-text-faint mt-1">{formatDate(row.updated_at || row.created_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-bold text-text-faint">No inventory records</p>
        )}
      </div>

      {/* Audit Ledger */}
      {data.ledger.length > 0 && (
        <div className="rounded-xl bg-surface-card border border-border-soft p-4">
          <h2 className={`${sectionLabel} mb-3`}>
            <History className="inline h-3 w-3 mr-1" />
            Stock Audit Log
          </h2>
          <div className="space-y-1">
            {data.ledger.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-lg bg-surface-canvas px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-black ${entry.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                  <span className="rounded-full bg-surface-strong px-2 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-text-muted">{entry.reason}</span>
                </div>
                <span className="text-micro font-bold text-text-faint">{formatDate(entry.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Location Transfer History */}
      {data.transfers && data.transfers.length > 0 && (
        <div className="rounded-xl bg-surface-card border border-border-soft p-4">
          <h2 className={`${sectionLabel} mb-3`}>
            <MapPin className="inline h-3 w-3 mr-1" />
            Location Transfers
          </h2>
          <div className="space-y-1">
            {data.transfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-surface-canvas px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className="text-text-faint">{t.from_location || '—'}</span>
                  <span className="text-text-faint">&rarr;</span>
                  <span className="text-blue-700">{t.to_location}</span>
                </div>
                <span className="text-micro font-bold text-text-faint">{formatDate(t.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit history */}
      <div className="bg-surface-card rounded-2xl p-4">
        <h2 className={`${sectionLabel} mb-3`}>
          <History className="inline h-3 w-3 mr-1" />
          History
        </h2>
        <AuditTimeline sku={data.sku} limit={50} compact noHeader />
      </div>
    </>
  );
}
