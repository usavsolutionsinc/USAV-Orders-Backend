'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Barcode, Check, Loader2, Plus } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { SidebarTabSwitchChrome, TabSwitch } from '@/components/ui/TabSwitch';
import {
  RepairIntakeForm,
  type RepairFormData,
} from '@/components/repair';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import type { RepairTab } from '@/lib/neon/repair-service-queries';
import { sectionLabel, cardTitle, microBadge } from '@/design-system/tokens/typography/presets';

interface RepairSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

interface EcwidSearchProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
}

function buildDraftFromFavorite(
  favorite: FavoriteSkuRecord,
  ecwidProduct?: EcwidSearchProduct | null,
  preSelectedReasons?: string[],
): Partial<RepairFormData> {
  return {
    product: {
      type: 'Bose Repair Service',
      model: ecwidProduct?.name || favorite.productTitle || favorite.label || favorite.sku,
      sourceSku: ecwidProduct?.sku || favorite.sku,
    },
    repairReasons: preSelectedReasons?.length ? preSelectedReasons : [],
    repairNotes: favorite.issueTemplate || '',
    price:
      ecwidProduct?.price != null
        ? ecwidProduct.price.toFixed(2)
        : favorite.defaultPrice || '130',
    notes: favorite.notes || '',
  };
}

export function RepairSidebarPanel({ embedded = false, hideSectionHeader = false }: RepairSidebarPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingFavorite, setIsFetchingFavorite] = useState(false);
  const [pickupScanValue, setPickupScanValue] = useState('');
  const [pickupScanSubmitting, setPickupScanSubmitting] = useState(false);
  const [pickupScanFeedback, setPickupScanFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [intakeDraft, setIntakeDraft] = useState<Partial<RepairFormData> | undefined>(undefined);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<number | null>(null);

  const rawTab = searchParams.get('tab');
  const activeTab: RepairTab = rawTab === 'incoming' ? 'incoming' : rawTab === 'done' ? 'done' : 'active';

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setSearchValue(searchParams.get('search') || '');
    if (searchParams.get('new') === 'true') {
      setShowIntakeForm(true);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('new');
      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/repair');
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!isMounted || !showIntakeForm) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMounted, showIntakeForm]);

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutate(nextParams);
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/repair');
  };

  const handleClearSearch = () => {
    setSearchValue('');
    updateParams((params) => {
      params.delete('search');
    });
  };

  const handleCloseForm = () => {
    setShowIntakeForm(false);
    setIntakeDraft(undefined);
    setSelectedFavoriteId(null);
  };

  const handleSubmitForm = async (data: RepairFormData) => {
    setIsSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/repair/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const result = await response.json();

      if (result.success) {
        setShowIntakeForm(false);
        setIntakeDraft(undefined);
        setSelectedFavoriteId(null);
        if (result.signatureWarning) {
          window.alert(`Repair submitted, but: ${result.signatureWarning}`);
        }
      } else {
        window.alert('Failed to submit repair form. Please try again.');
      }
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === 'AbortError') {
        window.alert('Submission timed out. Please check your connection and try again.');
      } else {
        window.alert('Error submitting repair form. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseFavorite = async (favorite: FavoriteSkuRecord) => {
    setIsFetchingFavorite(true);
    let ecwidProduct: EcwidSearchProduct | null = null;
    let skuReasons: string[] = [];
    try {
      const [ecwidRes, issuesRes] = await Promise.all([
        fetch(`/api/ecwid/products/search?q=${encodeURIComponent(favorite.sku)}`),
        fetch(`/api/repair/issues?favoriteSkuId=${favorite.id}`),
      ]);
      const ecwidData = await ecwidRes.json();
      const products: EcwidSearchProduct[] = Array.isArray(ecwidData?.products) ? ecwidData.products : [];
      ecwidProduct =
        products.find((p) => p.sku.trim().toLowerCase() === favorite.sku.trim().toLowerCase()) ??
        products[0] ??
        null;

      const issuesData = await issuesRes.json();
      if (Array.isArray(issuesData?.issues)) {
        // Pre-select only SKU-specific issues (not globals) as "same as template"
        skuReasons = issuesData.issues
          .filter((i: { favorite_sku_id: number | null }) => i.favorite_sku_id !== null)
          .map((i: { label: string }) => i.label);
      }
    } catch {
      // fall through — will use cached favorite data
    } finally {
      setIsFetchingFavorite(false);
    }
    setSelectedFavoriteId(favorite.id);
    setIntakeDraft(buildDraftFromFavorite(favorite, ecwidProduct, skuReasons));
    setShowIntakeForm(true);
  };

  const handlePickupScanSubmit = async () => {
    const scan = pickupScanValue.trim();
    if (!scan || pickupScanSubmitting) return;

    setPickupScanSubmitting(true);
    setPickupScanFeedback(null);

    try {
      const response = await fetch('/api/repair-service/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.details || result?.error || 'Failed to mark repair as picked up');
      }

      const fallbackId = Number.isFinite(Number(result?.repairId))
        ? `RS-${Number(result.repairId)}`
        : scan.toUpperCase();
      const displayId = String(result?.ticketNumber || '').trim() || fallbackId;

      setPickupScanValue('');
      setPickupScanFeedback({
        tone: 'success',
        message: result?.alreadyDone
          ? `${displayId} was already done.`
          : `${displayId} marked as picked up.`,
      });

      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (error: any) {
      setPickupScanFeedback({
        tone: 'error',
        message: error?.message || 'Pickup scan failed.',
      });
    } finally {
      setPickupScanSubmitting(false);
    }
  };

  const content = (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="shrink-0">
        {!hideSectionHeader ? (
          <div className="border-b border-gray-100 px-4 pt-4 pb-3">
            <p className={`${sectionLabel} text-orange-500`}>Repair Service</p>
            <h2 className={`mt-1 ${cardTitle}`}>Repairs</h2>
          </div>
        ) : null}

        <SidebarTabSwitchChrome>
          <TabSwitch
            tabs={[
              { id: 'incoming', label: 'Incoming', color: 'orange' },
              { id: 'active', label: 'Active', color: 'orange' },
              { id: 'done', label: 'Done', color: 'orange' },
            ]}
            activeTab={activeTab}
            highContrast
            onTabChange={(tab) =>
              updateParams((params) => {
                if (tab === 'active') params.delete('tab');
                else params.set('tab', tab);
              })
            }
          />
        </SidebarTabSwitchChrome>

        <div className="border-b border-gray-100 px-4 py-3">
          <SearchBar
            value={searchValue}
            onChange={setSearchValue}
            onSearch={() =>
              updateParams((params) => {
                if (searchValue.trim()) params.set('search', searchValue.trim());
                else params.delete('search');
              })
            }
            onClear={handleClearSearch}
            placeholder="Search repairs, tickets, SKU…"
            variant="orange"
            size="compact"
            rightElement={
              <button
                type="button"
                onClick={() => {
                  setIntakeDraft(undefined);
                  setSelectedFavoriteId(null);
                  setShowIntakeForm(true);
                }}
                disabled={isSubmitting}
                className="rounded-xl bg-orange-500 p-2.5 text-white transition-colors hover:bg-orange-600 disabled:bg-gray-400"
                title="New repair"
                aria-label="Open new repair order form"
              >
                <Plus className="h-5 w-5" />
              </button>
            }
          />
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 py-4">
        {isFetchingFavorite && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-orange-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className={sectionLabel}>Loading…</span>
            </div>
          </div>
        )}

        <div className="mb-4 border-b border-emerald-100 pb-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handlePickupScanSubmit();
            }}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Barcode className="h-3.5 w-3.5 text-emerald-500" />
                <span className={`${sectionLabel} text-emerald-600 leading-none`}>
                  Scan RS-ID Pickup
                </span>
              </div>
              <button
                type="submit"
                disabled={pickupScanSubmitting || !pickupScanValue.trim()}
                className="flex h-5 w-5 items-center justify-center text-emerald-500 transition-colors hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-gray-400"
                aria-label="Mark repair picked up"
                title="Mark repair picked up"
              >
                {pickupScanSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <input
              type="text"
              value={pickupScanValue}
              onChange={(event) => {
                setPickupScanValue(event.target.value);
                if (pickupScanFeedback) setPickupScanFeedback(null);
              }}
              placeholder="Scan RS-ID…"
              autoComplete="off"
              spellCheck={false}
              disabled={pickupScanSubmitting}
              className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </form>

          {pickupScanFeedback && (
            <p
              className={`mt-1.5 ${microBadge} ${
                pickupScanFeedback.tone === 'success' ? 'text-emerald-600' : 'text-red-500'
              }`}
            >
              {pickupScanFeedback.message}
            </p>
          )}
        </div>

        <FavoritesWorkspaceSection
          workspaceKey="repair"
          accent="orange"
          title="Favorites"
          description=""
          emptyLabel="No repair favorites yet"
          useLabel="Start Repair"
          allowRepairDefaults
          inlineRows
          buttonAccent="blue"
          onUseFavorite={handleUseFavorite}
          searchSkuSuffixFilter="-RS"
          fuzzyTitleSearch
          searchResultsMaxHeightClass="max-h-72"
        />
      </div>
    </div>
  );

  const intakeOverlay =
    isMounted && showIntakeForm
      ? createPortal(
          <div className="fixed inset-0 z-[130] bg-white">
            <RepairIntakeForm
              onClose={handleCloseForm}
              onSubmit={handleSubmitForm}
              initialData={intakeDraft}
              favoriteSkuId={selectedFavoriteId}
            />
          </div>,
          document.body,
        )
      : null;

  if (embedded) {
    return (
      <>
        <div className="h-full overflow-hidden bg-white">{content}</div>
        {intakeOverlay}
      </>
    );
  }

  return (
    <>
      <aside className="h-full overflow-hidden border-r border-gray-200 bg-white">{content}</aside>
      {intakeOverlay}
    </>
  );
}
