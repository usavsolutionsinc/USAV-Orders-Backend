'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Plus } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import {
  RepairIntakeForm,
  type RepairFormData,
} from '@/components/repair';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';

type RepairTab = 'active' | 'done';

interface RepairSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

function buildDraftFromFavorite(favorite: FavoriteSkuRecord): Partial<RepairFormData> {
  return {
    product: {
      type: 'Other',
      model: favorite.productTitle || favorite.label || favorite.sku,
    },
    repairReasons: [],
    repairNotes: favorite.issueTemplate || '',
    price: favorite.defaultPrice || '130',
    notes: favorite.notes || '',
  };
}

export function RepairSidebarPanel({ embedded = false, hideSectionHeader = false }: RepairSidebarPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [intakeDraft, setIntakeDraft] = useState<Partial<RepairFormData> | undefined>(undefined);

  const activeTab: RepairTab = searchParams.get('tab') === 'done' ? 'done' : 'active';

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
  };

  const handleSubmitForm = async (data: RepairFormData) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/repair/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        setShowIntakeForm(false);
        setIntakeDraft(undefined);
        window.open(`/api/repair-service/print/${result.id}`, '_blank');
      } else {
        window.alert('Failed to submit repair form. Please try again.');
      }
    } catch (_error) {
      window.alert('Error submitting repair form. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseFavorite = (favorite: FavoriteSkuRecord) => {
    setIntakeDraft(buildDraftFromFavorite(favorite));
    setShowIntakeForm(true);
  };

  const content = (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-100 px-4 py-4">
        {!hideSectionHeader ? (
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-orange-500">Repair Service</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-gray-900">Repairs</h2>
          </div>
        ) : null}

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
                setShowIntakeForm(true);
              }}
              disabled={isSubmitting}
              className="rounded-xl bg-orange-500 p-2.5 text-white transition-colors hover:bg-orange-600 disabled:bg-gray-300"
              title="New repair"
              aria-label="Open new repair order form"
            >
              <Plus className="h-5 w-5" />
            </button>
          }
        />

        <div className="mt-3">
          <TabSwitch
            tabs={[
              { id: 'active', label: 'Active', color: 'orange' },
              { id: 'done', label: 'Done', color: 'orange' },
            ]}
            activeTab={activeTab}
            onTabChange={(tab) =>
              updateParams((params) => {
                if (tab === 'done') params.set('tab', 'done');
                else params.delete('tab');
              })
            }
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
