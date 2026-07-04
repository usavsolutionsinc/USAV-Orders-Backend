'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { ClipboardList, Download, FileText, Link2, Loader2 } from '@/components/Icons';
import { ProductHubPanel } from '@/components/products/pairing/ProductHubPanel';
import { ChecklistSection } from '@/components/tech/sku-testing/ChecklistSection';
import { ManualsSection } from '@/components/tech/sku-testing/ManualsSection';
import { useSkuTestingData } from '@/components/tech/sku-testing/useSkuTestingData';

/** Custom event the testing toolbar "Pair" action dispatches to jump here. */
export const TESTING_OPEN_SKU_PAIRING_EVENT = 'testing-open-sku-pairing';

type TestingTab = 'notes' | 'pairing' | 'checklist' | 'manuals';

function focusTextEnd(el: HTMLTextAreaElement | null) {
  if (!el) return;
  const len = el.value.length;
  el.focus();
  el.setSelectionRange(len, len);
  el.scrollTop = el.scrollHeight;
}

const NOTES_TEXTAREA_FOCUS =
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/**
 * Tabbed notes · SKU pairing · testing checklist · manuals card for the testing
 * workspace — same `HorizontalButtonSlider` nav pills as {@link LineNotesTabbedCard}.
 * Checklist and manuals tabs appear when the line has a SKU.
 */
export function LineTestingTabbedCard({
  notes,
  onChange,
  onBlur,
  skuCatalogId,
  headerTitle,
  receivingLineId,
  sku,
  serialUnitId,
}: {
  notes: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  skuCatalogId: number | null;
  /** Zoho / line title for the pairing hub header. */
  headerTitle?: string | null;
  /** Active receiving line — required for checklist + manuals tabs. */
  receivingLineId?: number;
  /** Line SKU — when set, enables the checklist + manuals tabs. */
  sku?: string | null;
  /** Active scanned unit, if any — enables per-unit checklist recording. */
  serialUnitId?: number | null;
}) {
  const [tab, setTab] = useState<TestingTab>('notes');
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const cardTopRef = useRef<HTMLDivElement>(null);
  const hasSkuTabs = Boolean(sku && receivingLineId != null);

  const focusNotes = useCallback(() => {
    requestAnimationFrame(() => focusTextEnd(notesTextareaRef.current));
  }, []);

  const handleTabChange = useCallback(
    (id: string) => {
      const next = id as TestingTab;
      setTab(next);
      if (next === 'notes') focusNotes();
    },
    [focusNotes],
  );

  useEffect(() => {
    const openPairing = () => {
      setTab('pairing');
      requestAnimationFrame(() =>
        cardTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    };
    window.addEventListener(TESTING_OPEN_SKU_PAIRING_EVENT, openPairing);
    return () => window.removeEventListener(TESTING_OPEN_SKU_PAIRING_EVENT, openPairing);
  }, []);

  const items: HorizontalSliderItem[] = useMemo(() => {
    const base: HorizontalSliderItem[] = [
      { id: 'notes', label: 'Notes', icon: FileText },
      { id: 'pairing', label: 'SKU Pairing', icon: Link2 },
    ];
    if (hasSkuTabs) {
      base.push(
        { id: 'checklist', label: 'Checklist', icon: ClipboardList },
        { id: 'manuals', label: 'Manuals', icon: Download },
      );
    }
    return base;
  }, [hasSkuTabs]);

  return (
    <section
      ref={cardTopRef}
      className="space-y-3 rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60"
    >
      <HorizontalButtonSlider
        variant="nav"
        dense
        overlay
        items={items}
        value={tab}
        onChange={handleTabChange}
        aria-label="Testing tabs"
      />

      {tab === 'notes' ? (
        <textarea
          ref={notesTextareaRef}
          rows={2}
          aria-label="Notes"
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={`w-full resize-none rounded-lg border border-border-soft px-3 py-2 text-caption text-text-default ${NOTES_TEXTAREA_FOCUS}`}
        />
      ) : null}

      {tab === 'pairing' ? (
        skuCatalogId != null ? (
          <div className="flex h-[28rem] min-h-0 flex-col overflow-hidden rounded-lg ring-1 ring-inset ring-border-hairline">
            <ProductHubPanel
              skuCatalogId={skuCatalogId}
              allowManualPair
              headerTitle={headerTitle}
            />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-5 text-center text-xs text-text-soft">
            This line has no catalog SKU yet — pair it to Zoho in receiving before
            cross-platform SKU pairing is available.
          </p>
        )
      ) : null}

      {hasSkuTabs && receivingLineId != null && sku ? (
        <TestingSkuTabBody
          tab={tab}
          receivingLineId={receivingLineId}
          sku={sku}
          title={headerTitle ?? sku}
          serialUnitId={serialUnitId ?? null}
        />
      ) : null}
    </section>
  );
}

/** Loads the SKU testing bundle once; renders checklist or manuals tab bodies. */
function TestingSkuTabBody({
  tab,
  receivingLineId,
  sku,
  title,
  serialUnitId,
}: {
  tab: TestingTab;
  receivingLineId: number;
  sku: string;
  title: string;
  serialUnitId: number | null;
}) {
  const { bundle, loading, results, canRecord, loadBundle, loadResults, onResultChange } =
    useSkuTestingData(receivingLineId, sku, title, serialUnitId);

  if (loading) {
    if (tab !== 'checklist' && tab !== 'manuals') return null;
    return (
      <div className="flex items-center gap-2 py-4 text-caption text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading testing details…
      </div>
    );
  }
  if (!bundle) return null;
  if (tab !== 'checklist' && tab !== 'manuals') return null;

  if (tab === 'checklist') {
    return (
      <ChecklistSection
        embedded
        receivingLineId={receivingLineId}
        bundle={bundle}
        results={results}
        canRecord={canRecord}
        serialUnitId={serialUnitId}
        onChanged={loadBundle}
        onReloadResults={loadResults}
        onResultChange={onResultChange}
      />
    );
  }

  if (tab === 'manuals') {
    return (
      <ManualsSection
        embedded
        receivingLineId={receivingLineId}
        bundle={bundle}
        onChanged={loadBundle}
      />
    );
  }

  return null;
}
