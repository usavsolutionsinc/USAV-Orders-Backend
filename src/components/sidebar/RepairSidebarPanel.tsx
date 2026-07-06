'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Check, Loader2, Plus, Tool } from '@/components/Icons';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { IconButton } from '@/design-system/primitives';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useBodyScrollLock } from '@/design-system/hooks';
import { toast } from '@/lib/toast';

// Incoming repairs now live in the Receiving incoming display, so this queue
// only exposes Active and Done.
const REPAIR_TAB_ITEMS: HorizontalSliderItem[] = [
  { id: 'active', label: 'Active', icon: Tool },
  { id: 'done',   label: 'Done',   icon: Check },
];
import {
  RepairIntakeForm,
  type RepairFormData,
  type RepairSubmitResult,
} from '@/components/repair';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import type { RepairTab } from '@/lib/neon/repair-service-queries';
import { sectionLabel, cardTitle } from '@/design-system/tokens/typography/presets';
import {
  buildDraftFromFavorite,
  fetchFavoriteIntakeContext,
} from '@/components/repair/repair-favorite-intake';

interface RepairSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

const REPAIR_SUBMIT_TIMEOUT_MS = 60_000;

export function RepairSidebarPanel({ embedded = false, hideSectionHeader = false }: RepairSidebarPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingFavorite, setIsFetchingFavorite] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [intakeDraft, setIntakeDraft] = useState<Partial<RepairFormData> | undefined>(undefined);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<number | null>(null);
  // Idempotency key for the in-flight intake submission. Persists across failed
  // retries (so a replay dedupes the Zendesk ticket) and is cleared on success.
  const repairIdemKey = useRef<string | null>(null);

  const masterNavEnabled = useMasterNavEnabled();
  const rawTab = searchParams.get('tab');
  const activeTab: RepairTab = rawTab === 'done' ? 'done' : 'active';

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

  useBodyScrollLock(isMounted && showIntakeForm);

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

  const handleSubmitForm = async (data: RepairFormData): Promise<RepairSubmitResult | null> => {
    setIsSubmitting(true);
    if (!repairIdemKey.current) repairIdemKey.current = safeRandomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPAIR_SUBMIT_TIMEOUT_MS);
    try {
      const response = await fetch('/api/repair/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': repairIdemKey.current,
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      let result: Record<string, unknown>;
      try {
        result = await response.json();
      } catch {
        throw new Error(
          response.ok
            ? 'Invalid response from server. Please try again.'
            : `Failed to submit repair (${response.status}). Please try again.`,
        );
      }

      if (response.ok && result.success) {
        repairIdemKey.current = null;
        const ticketUrl: string | null =
          typeof result.zendeskTicketUrl === 'string' ? result.zendeskTicketUrl : null;
        const ticketSuffix = result.zendeskTicketNumber
          ? ` — ticket ${result.zendeskTicketNumber}`
          : '';
        toast.success(`Repair ${result.rsNumber ?? ''} submitted${ticketSuffix}`.trim(), {
          action: ticketUrl
            ? { label: 'Open', onClick: () => window.open(ticketUrl, '_blank', 'noopener') }
            : undefined,
        });
        if (result.signatureWarning) {
          toast.warning(`Repair submitted, but: ${String(result.signatureWarning)}`);
        }
        return {
          id: Number(result.id),
          rsNumber: (result.rsNumber as string | number | null | undefined) ?? null,
          zendeskTicketNumber: (result.zendeskTicketNumber as string | null | undefined) ?? null,
          zendeskTicketUrl: ticketUrl,
        };
      }

      const message =
        typeof result.error === 'string' && result.error.trim()
          ? result.error
          : typeof result.details === 'string' && result.details.trim()
            ? result.details
            : `Failed to submit repair form (${response.status}). Please try again.`;
      throw new Error(message);
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          'Submission timed out. The repair may already have been saved — check the Active repairs list before submitting again.',
        );
      }
      if (error instanceof Error) throw error;
      throw new Error('Error submitting repair form. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseFavorite = async (favorite: FavoriteSkuRecord) => {
    setIsFetchingFavorite(true);
    try {
      const { ecwidProduct, skuReasons } = await fetchFavoriteIntakeContext(favorite);
      setSelectedFavoriteId(favorite.id);
      setIntakeDraft(buildDraftFromFavorite(favorite, ecwidProduct, skuReasons));
      setShowIntakeForm(true);
    } finally {
      setIsFetchingFavorite(false);
    }
  };

  const content = (
    <SidebarShell
      className="bg-surface-card"
      headerAbove={
        !hideSectionHeader ? (
          <div className={`border-b border-border-hairline ${SIDEBAR_GUTTER} pt-4 pb-3`}>
            <p className={`${sectionLabel} text-orange-500`}>Repair Service</p>
            <h2 className={`mt-1 ${cardTitle}`}>Repairs</h2>
          </div>
        ) : null
      }
      search={{
        value: searchValue,
        onChange: setSearchValue,
        onSearch: () =>
          updateParams((params) => {
            if (searchValue.trim()) params.set('search', searchValue.trim());
            else params.delete('search');
          }),
        onClear: handleClearSearch,
        placeholder: 'Search repairs, tickets, SKU…',
        variant: 'orange',
        rightElement: (
          <HoverTooltip label="New repair" asChild>
          <IconButton
            type="button"
            onClick={() => {
              setIntakeDraft(undefined);
              setSelectedFavoriteId(null);
              setShowIntakeForm(true);
            }}
            disabled={isSubmitting}
            ariaLabel="Open new repair order form"
            icon={<Plus className="h-5 w-5 text-white" />}
            className="rounded-xl bg-orange-500 p-2.5 text-white transition-colors hover:bg-orange-600 disabled:bg-border-emphasis"
          />
          </HoverTooltip>
        ),
      }}
      headerRows={[
        !masterNavEnabled ? (
          <HorizontalButtonSlider
            items={REPAIR_TAB_ITEMS}
            value={activeTab}
            onChange={(tab) =>
              updateParams((params) => {
                if (tab === 'active') params.delete('tab');
                else params.set('tab', tab);
              })
            }
            variant="nav"
            dense
            className="w-full"
            aria-label="Repair queue"
          />
        ) : null,
      ]}
      bodyClassName="relative pb-4"
    >
        {isFetchingFavorite && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-surface-card/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-orange-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className={sectionLabel}>Loading…</span>
            </div>
          </div>
        )}

        {activeTab === 'active' && (
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
        )}
    </SidebarShell>
  );

  const intakeOverlay =
    isMounted && showIntakeForm
      ? createPortal(
          <div className="fixed inset-0 z-panelOverlay bg-surface-card">
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
        <div className="h-full overflow-hidden bg-surface-card">{content}</div>
        {intakeOverlay}
      </>
    );
  }

  return (
    <>
      <aside className="h-full overflow-hidden border-r border-border-soft bg-surface-card">{content}</aside>
      {intakeOverlay}
    </>
  );
}
