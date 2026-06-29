'use client';

import { cn } from '@/utils/_cn';
import { Button } from '@/design-system/primitives';
import { MODE_TABS } from './mailbox/po-mailbox-types';
import { usePoMailbox } from './mailbox/usePoMailbox';
import { MissingMode } from './mailbox/MissingMode';
import { ScannedMode } from './mailbox/ScannedMode';
import { RawMode } from './mailbox/RawMode';

/**
 * PO email reconciler — scan unread emails, diff against Zoho POs (via
 * receiving_lines), and track missing ones. Thin composition layer — state/logic
 * live in {@link usePoMailbox}; the three mode views live under `./mailbox/`.
 */
export function PoMailboxPreviewPanel({
  title = 'PO email reconciler',
  description = 'Scan unread emails, diff against Zoho POs (via receiving_lines), and track missing ones.',
  embedded = false,
}: { title?: string | null; description?: string | null; embedded?: boolean }) {
  const m = usePoMailbox();

  return (
    <section className={embedded ? 'space-y-2.5' : 'space-y-4'}>
      {!embedded && (title || description) && (
        <div>
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {description && <p className="mt-0.5 text-label text-gray-500">{description}</p>}
        </div>
      )}

      {/* Mode toggle — small inline pill row */}
      <div className={`${embedded ? 'flex w-full' : 'inline-flex'} rounded-md border border-gray-200 bg-white p-0.5`}>
        {MODE_TABS.map((t) => (
          <Button
            key={t.id}
            variant={m.mode === t.id ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => m.setMode(t.id)}
            className={cn('rounded-[5px]', embedded && 'flex-1')}
          >
            {embedded ? t.label.replace('Missing from ', '').replace('All scanned', 'Scanned').replace('Raw preview', 'Raw') : t.label}
          </Button>
        ))}
      </div>

      {m.mode === 'missing' && (
        <MissingMode
          missing={m.missing}
          loading={m.missingLoading}
          statusFilter={m.missingStatusFilter}
          onStatusFilter={m.setMissingStatusFilter}
          onRefresh={m.fetchMissing}
          onAct={m.updateMissingStatus}
          actingId={m.actingId}
          onRunReconcile={m.runReconcile}
          scanQuery={m.scanQuery}
          setScanQuery={m.setScanQuery}
          scanLimit={m.scanLimit}
          setScanLimit={m.setScanLimit}
          scanLoading={m.scanLoading}
        />
      )}

      {m.mode === 'scanned' && (
        <ScannedMode
          response={m.reconcile}
          loading={m.scanLoading}
          query={m.scanQuery}
          setQuery={m.setScanQuery}
          limit={m.scanLimit}
          setLimit={m.setScanLimit}
          onRun={m.runReconcile}
          expanded={m.expanded}
          setExpanded={m.setExpanded}
        />
      )}

      {m.mode === 'raw' && (
        <RawMode
          response={m.preview}
          loading={m.scanLoading}
          query={m.scanQuery}
          setQuery={m.setScanQuery}
          limit={m.scanLimit}
          setLimit={m.setScanLimit}
          onRun={m.runRawPreview}
          expanded={m.expanded}
          setExpanded={m.setExpanded}
        />
      )}
    </section>
  );
}
