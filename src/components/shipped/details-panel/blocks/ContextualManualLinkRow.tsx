'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, ExternalLink } from '@/components/Icons';
import { DetailsPanelRow, InlineSaveIndicator } from '@/design-system/components';

function extractGoogleFileId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const driveMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch?.[1]) return driveMatch[1];
  const docMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch?.[1]) return docMatch[1];
  const queryMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];
  return raw;
}

interface ContextualManualLinkRowProps {
  sku?: string | null;
  itemNumber?: string | null;
  onSaved?: (fileId: string) => void;
  allowEmbeddedItemNumberInput?: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ContextualManualLinkRow({
  sku,
  itemNumber,
  onSaved,
  allowEmbeddedItemNumberInput = true,
}: ContextualManualLinkRowProps) {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const normalizedItemNumber = String(itemNumber || '').trim().toUpperCase();
  const [localItemNumber, setLocalItemNumber] = useState(normalizedItemNumber);
  const [googleInput, setGoogleInput] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedFileId, setSavedFileId] = useState<string | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);
  const googleInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedFileIdRef = useRef('');

  const effectiveItemNumber = normalizedItemNumber || localItemNumber.trim().toUpperCase();
  const contextualKey = effectiveItemNumber || normalizedSku || 'order';
  const pendingFileId = extractGoogleFileId(googleInput);
  const canSave = Boolean(effectiveItemNumber && pendingFileId);

  useEffect(() => {
    setLocalItemNumber(normalizedItemNumber);
  }, [normalizedItemNumber]);

  useEffect(() => {
    if (!saveState || saveState === 'saving' || saveState === 'idle') return;
    const timeout = window.setTimeout(() => setSaveState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!canSave || pendingFileId === lastSavedFileIdRef.current) return;

    saveTimerRef.current = window.setTimeout(() => {
      void saveManual();
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [canSave, pendingFileId]);

  const saveManual = async () => {
    if (!effectiveItemNumber) {
      itemInputRef.current?.focus();
      return;
    }
    if (!pendingFileId || pendingFileId === lastSavedFileIdRef.current) return;

    setSaveState('saving');
    try {
      const res = await fetch('/api/product-manuals/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: effectiveItemNumber,
          item_number: effectiveItemNumber,
          sku: normalizedSku || effectiveItemNumber,
          googleDocId: pendingFileId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      const resolvedFileId = String(data?.manual?.google_file_id || pendingFileId);
      lastSavedFileIdRef.current = resolvedFileId;
      setSavedFileId(resolvedFileId);
      setGoogleInput(resolvedFileId);
      setSaveState('saved');
      onSaved?.(resolvedFileId);
    } catch (_error) {
      setSaveState('error');
    }
  };

  const openUrl = useMemo(() => {
    if (!savedFileId) return null;
    return `https://drive.google.com/file/d/${savedFileId}/view`;
  }, [savedFileId]);

  return (
    <DetailsPanelRow
      label="Product Manual"
      headerAccessory={
        (effectiveItemNumber || normalizedSku) ? (
          <span className="truncate text-[10px] font-black uppercase tracking-wide text-gray-500">
            {effectiveItemNumber || normalizedSku}
          </span>
        ) : null
      }
      actions={(
        <div className="flex items-center gap-2">
          <InlineSaveIndicator state={saveState} />
          {openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 transition-colors hover:text-blue-600"
              aria-label={`Open manual for ${contextualKey}`}
              title="Open manual"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      )}
    >
      <div className="w-full space-y-2">
        {allowEmbeddedItemNumberInput && !normalizedItemNumber ? (
          <input
            ref={itemInputRef}
            type="text"
            value={localItemNumber}
            onChange={(e) => {
              setLocalItemNumber(e.target.value);
              setSaveState('idle');
            }}
            placeholder="Item number"
            className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold uppercase tracking-wide text-gray-900 outline-none"
          />
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={googleInputRef}
            type="text"
            value={googleInput}
            onChange={(e) => {
              setGoogleInput(e.target.value);
              setSaveState('idle');
            }}
            onBlur={() => { void saveManual(); }}
            placeholder={
              effectiveItemNumber
                ? `Paste manual link or file ID for ${contextualKey}`
                : 'Enter item number'
            }
            disabled={!effectiveItemNumber}
            className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 disabled:text-gray-400"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text.trim()) {
                  setGoogleInput(text.trim());
                  setSaveState('idle');
                }
              } catch {
                // noop
              }
              googleInputRef.current?.focus();
            }}
            className="shrink-0 text-gray-400 transition-colors hover:text-blue-600"
            aria-label={`Paste manual link for ${contextualKey}`}
            title="Paste manual link"
          >
            <Clipboard className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </DetailsPanelRow>
  );
}
