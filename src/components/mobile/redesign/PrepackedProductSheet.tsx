'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Package,
  MapPin,
  Loader2,
  History,
  Box,
  Camera,
} from '@/components/Icons';
import {
  TOKENS,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { SerialChip, SkuSerialChip } from '@/components/ui/CopyChip';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ScanInput } from '@/components/mobile/redesign/ScanInput';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import { compressPhotoForUpload } from '@/lib/image/compress-for-upload';
import { useNasConfig } from '@/hooks/useNasConfig';
import { getNasBaseUrl, putNasPhoto } from '@/lib/nas-photos';
import { describeUnitId } from '@/lib/inventory/unit-id-format';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import type { InventoryEventRow } from '@/lib/inventory/events';

/**
 * Prepacked Products bottom sheet — the scan-to-verify + scan-to-locate surface
 * for the `/m/scan` "Prepacked Products" mode.
 *
 * On scanning a unit label it resolves the unit (resolver cascade below) and
 * shows full product detail + lifecycle history. The operator can then scan a
 * SECOND QR (a bin/location) with the same {@link ScanInput} to put the unit
 * away — reusing the already-built `POST /api/serial-units/[id]/move`.
 *
 * Resolver cascade (graceful degrade — see plan):
 *   1. GET  /api/serial-units/{serial}  → live status/location/history (tracked)
 *   2. (GS1 Digital Link URL) extract the (21) serial and retry step 1
 *   3. POST /api/units/resolve-id        → product metadata only (untracked)
 * The location-bind action is enabled only when a tracked serial_units row
 * resolves (it needs a numeric unit id); otherwise it's shown disabled.
 */

interface SerialUnit {
  id: number;
  serial_number: string | null;
  sku: string | null;
  current_status: string | null;
  current_location: string | null;
  condition_grade: string | null;
  product_title: string | null;
}

type PrepackResult =
  | { source: 'tracked'; serial: string; unit: SerialUnit; events: InventoryEventRow[] }
  | { source: 'untracked'; serial: string; product: { sku: string | null; productTitle: string | null; gtin: string | null } }
  | { source: 'unknown'; serial: string };

/** Pull the (21) serial + (01) GTIN out of a GS1 Digital Link URL, else echo. */
function extractUnitFromScan(raw: string): { serial: string; gtin: string | null } {
  const v = raw.trim();
  const m21 = v.match(/\/21\/([^/?#]+)/);
  const m01 = v.match(/\/01\/([^/?#]+)/);
  if (m21) return { serial: decodeURIComponent(m21[1]), gtin: m01 ? m01[1] : null };
  return { serial: v, gtin: null };
}

async function resolvePrepacked(scanned: string): Promise<PrepackResult> {
  const { serial, gtin } = extractUnitFromScan(scanned);

  // 1+2. Live serial_units row (route accepts numeric id OR a serial string).
  // `orPrint=1` adds the desktop's print-record fallback: a printed label with
  // no serial_units row still resolves — to the REAL device serial linked via
  // the LABELED inventory_event — so untracked units show a serial, not blank.
  try {
    const r = await fetch(`/api/serial-units/${encodeURIComponent(serial)}?orPrint=1`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json().catch(() => null);
      if (d?.success && d.serial_unit) {
        return { source: 'tracked', serial, unit: d.serial_unit as SerialUnit, events: (d.events ?? []) as InventoryEventRow[] };
      }
    }
  } catch {
    /* fall through to metadata */
  }

  // 3. Product metadata fallback (no live unit row).
  try {
    const pr = await fetch('/api/units/resolve-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ unitId: serial }),
    });
    if (pr.ok) {
      const pd = await pr.json().catch(() => null);
      if (pd?.ok) {
        return { source: 'untracked', serial, product: { sku: pd.sku ?? null, productTitle: pd.productTitle ?? null, gtin: pd.gtin ?? gtin } };
      }
    }
  } catch {
    /* fall through to unknown */
  }

  return { source: 'unknown', serial };
}

/**
 * NAS destination for a unit photo. Flat filename in the operator's folder, led
 * by `U{unitId}__` so a human sorting the folder sees the unit grouping — mirrors
 * the receiving `buildNasPhotoUrl` poPart convention (a flat name keeps WebDAV
 * PUT working without auto-creating per-unit subfolders).
 */
function buildUnitNasUrl(baseUrl: string, folder: string, unitId: number, shotId: string): string {
  const segments: string[] = [];
  const cleanFolder = (folder || '').replace(/^\/+|\/+$/g, '');
  if (cleanFolder) segments.push(...cleanFolder.split('/'));
  segments.push(`U${unitId}__${shotId}.jpg`);
  return `${baseUrl.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}`;
}

function humanizeEvent(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PrepackedProductSheet({ scanned, onClose }: { scanned: string | null; onClose: () => void }) {
  // Keep the last scanned value mounted through the close animation so content
  // doesn't blank out while the sheet slides away.
  const [shown, setShown] = useState<string | null>(scanned);
  useEffect(() => {
    if (scanned) setShown(scanned);
  }, [scanned]);

  const [locationOpen, setLocationOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const moveCounter = useRef(0);
  // Pack-station photo capture: scan the unit QR (this sheet) → take photos →
  // store under the unit (entity_type='SERIAL_UNIT') on the NAS.
  const nas = useNasConfig();
  const [capturing, setCapturing] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);

  const { data, isLoading, refetch } = useQuery<PrepackResult>({
    queryKey: ['prepack-unit', shown],
    queryFn: () => resolvePrepacked(shown as string),
    enabled: scanned != null && shown != null,
    staleTime: 0,
  });

  // Close the location step whenever the sheet itself closes.
  useEffect(() => {
    if (scanned == null) setLocationOpen(false);
  }, [scanned]);

  // Discriminant casts: pin the union member after checking `source`. Avoids
  // relying on control-flow narrowing through the query result, which varies by
  // @tanstack/react-query typing version.
  const tracked = data?.source === 'tracked' ? (data as Extract<PrepackResult, { source: 'tracked' }>) : null;
  const untracked = data?.source === 'untracked' ? (data as Extract<PrepackResult, { source: 'untracked' }>) : null;
  // Put-away needs a real serial_units row (numeric id). The print fallback can
  // resolve a serial for display while returning id 0 (no live row) — guard it.
  const liveUnitId = tracked && tracked.unit.id > 0 ? tracked.unit.id : null;
  const parsed = shown ? describeUnitId(extractUnitFromScan(shown).serial) : null;

  const title =
    tracked?.unit.product_title ??
    (untracked ? untracked.product.productTitle : null) ??
    'Prepacked Product';
  const sku = tracked?.unit.sku ?? (untracked ? untracked.product.sku : null);
  const gtin = untracked ? untracked.product.gtin : null;
  const serialText = tracked?.unit.serial_number ?? data?.serial ?? shown ?? '';

  async function handleLocationDecode(value: string) {
    if (!liveUnitId) return;
    const bin = value.trim();
    if (!bin || moving) return;
    setMoving(true);
    try {
      const res = await fetch(`/api/serial-units/${liveUnitId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bin_barcode: bin,
          bin_name: bin,
          client_event_id: `m-prepack-move-${liveUnitId}-${++moveCounter.current}-${bin}`,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        toast.error(d?.error || `Move failed (${res.status})`);
        return;
      }
      toast.success(`Moved to ${d.location?.name ?? bin}`);
      setLocationOpen(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error during move');
    } finally {
      setMoving(false);
    }
  }

  // ── Pack photos: compress each shot, PUT browser-direct to the NAS, then link
  // them all to the unit in ONE POST (which emits a single timeline NOTE). ──
  async function handleCapturedPhotos(shots: CapturedShot[]) {
    setCapturing(false);
    if (!liveUnitId || shots.length === 0) {
      shots.forEach((s) => { try { URL.revokeObjectURL(s.previewUrl); } catch { /* ignore */ } });
      return;
    }
    const baseUrl = nas?.baseUrl || getNasBaseUrl();
    if (!baseUrl) {
      toast.error('NAS not configured — set the NAS address in Admin → Receiving Photos.');
      return;
    }
    setSavingPhotos(true);
    try {
      const urls: string[] = [];
      for (const shot of shots) {
        try {
          const compressed = await compressPhotoForUpload(shot.blob, { source: 'm-prepack' });
          const targetUrl = buildUnitNasUrl(baseUrl, nas?.folder ?? '', liveUnitId, shot.id);
          const put = await putNasPhoto(targetUrl, compressed.blob);
          if (put.ok) urls.push(put.url);
        } catch {
          /* skip this shot, keep going */
        }
      }
      if (urls.length === 0) {
        toast.error('Could not save photos to the NAS.');
        return;
      }
      const res = await fetch(`/api/serial-units/${liveUnitId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photoUrls: urls, stage: 'shipout' }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        toast.error(d?.error || `Save failed (${res.status})`);
        return;
      }
      const n = d.inserted ?? urls.length;
      toast.success(`Saved ${n} photo${n === 1 ? '' : 's'}`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error saving photos');
    } finally {
      setSavingPhotos(false);
      shots.forEach((s) => { try { URL.revokeObjectURL(s.previewUrl); } catch { /* ignore */ } });
    }
  }

  return (
    <>
      <BottomSheet open={scanned != null} onClose={onClose} maxWidth="32rem">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-16 text-blue-300">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Package className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                {/* PRIMARY — product title; SKU + serial below as copy chips
                    (same primitives as the desktop identity card). */}
                <p className="text-lg font-black leading-snug tracking-tight text-blue-950">{title}</p>
                <div className="mt-1.5 space-y-1">
                  {sku && (
                    <ChipRow label="SKU">
                      <SkuSerialChip value={sku} display={sku} width="w-fit" />
                    </ChipRow>
                  )}
                  {serialText && (
                    <ChipRow label="Serial">
                      <SerialChip value={serialText} width="w-fit" />
                    </ChipRow>
                  )}
                </div>
              </div>
            </div>

            {/* Raw label identifiers — the scanned QR/unit id + GTIN. */}
            <div className="flex flex-wrap items-center gap-2">
              {parsed && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-950 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                  <Box className="h-3.5 w-3.5" />
                  {parsed.display}
                </span>
              )}
              {gtin && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold tracking-wide text-slate-500">
                  GTIN {gtin}
                </span>
              )}
            </div>

            {/* Status row */}
            <div className="grid grid-cols-3 gap-2">
              <StatField label="Status" value={tracked?.unit.current_status ?? (data.source === 'untracked' ? 'Not tracked' : '—')} />
              <StatField label="Condition" value={tracked ? conditionGradeTableLabel(tracked.unit.condition_grade) : '—'} />
              <StatField
                label="Location"
                value={tracked?.unit.current_location ?? '—'}
                icon={<MapPin className="h-3.5 w-3.5 text-blue-400" />}
              />
            </div>

            {/* Put-away + photo capture — both need a real serial_units row. */}
            {liveUnitId ? (
              <div className="flex flex-col gap-2">
                <GlassButton
                  variant="primary"
                  className="w-full !rounded-[24px]"
                  icon={MapPin}
                  onClick={() => setLocationOpen(true)}
                >
                  Scan location to put away
                </GlassButton>
                <GlassButton
                  variant="secondary"
                  className="w-full !rounded-[24px]"
                  icon={savingPhotos ? Loader2 : Camera}
                  onClick={() => {
                    if (!savingPhotos) setCapturing(true);
                  }}
                >
                  {savingPhotos ? 'Saving photos…' : 'Take photos'}
                </GlassButton>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                <p className="text-xs font-bold leading-relaxed text-amber-700">
                  {data.source === 'unknown'
                    ? 'Could not resolve this label to a product.'
                    : 'Unit not individually tracked yet — receive/test it first to assign a location.'}
                </p>
              </div>
            )}

            {/* History */}
            <div>
              <SectionHeader title="History" />
              {tracked && tracked.events.length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {tracked.events.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 rounded-2xl border border-blue-50 bg-white px-3 py-2.5">
                      <History className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black tracking-tight text-blue-950">{humanizeEvent(e.event_type)}</p>
                        <p className="truncate text-[11px] font-semibold text-blue-400">
                          {[e.station, e.next_status, e.notes].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-bold text-blue-300">{formatWhen(e.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 px-4 py-6 text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-blue-300">
                    {tracked ? 'No history yet' : 'No history for untracked units'}
                  </p>
                  {/* Show the serial even with no events — mirrors the desktop
                      detail page (which always surfaces the serial). */}
                  {serialText && (
                    <ChipRow label="Serial">
                      <SerialChip value={serialText} width="w-fit" />
                    </ChipRow>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className={`mt-1 w-full rounded-[20px] py-3 text-sm font-black uppercase tracking-wider ${TOKENS.colors.text.muted}`}
            >
              Done
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Stacked location-scan step — same ScanInput component. */}
      <BottomSheet open={locationOpen} onClose={() => setLocationOpen(false)} level={1} title="Scan location">
        <p className="mb-3 text-center text-xs font-semibold text-blue-400">
          Scan or type the bin / location QR to put this unit away.
        </p>
        <ScanInput
          compact
          autoFocus
          placeholder="Scan a bin / location QR"
          cameraButtonLabel="Open Camera"
          onDecode={handleLocationDecode}
        />
        {moving && (
          <div className="mt-3 flex items-center justify-center gap-2 text-blue-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs font-bold uppercase tracking-wider">Moving…</span>
          </div>
        )}
      </BottomSheet>

      {/* Fullscreen rapid-capture camera — opens over the sheet; on Done the
          shots are compressed, PUT to the NAS, and linked to this unit. */}
      {capturing && liveUnitId ? (
        <MobilePackerSpamCamera
          onDone={handleCapturedPhotos}
          onCancel={() => setCapturing(false)}
          maxPhotos={10}
          header={
            <div className="min-w-0">
              <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
                Pack photos
              </p>
              <p className="truncate text-sm font-black text-white">{title}</p>
            </div>
          }
        />
      ) : null}
    </>
  );
}

/** Tiny label + copy chip, mirroring the desktop identity card's ChipRow. */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-blue-300">
        {label}
      </span>
      {children}
    </div>
  );
}

function StatField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-300">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        {icon}
        <p className="truncate text-sm font-black tracking-tight text-blue-950">{value}</p>
      </div>
    </div>
  );
}
