'use client';

import { useState } from 'react';

interface PhotoLibraryToolbarProps {
  selectedIds: number[];
  onClearSelection: () => void;
  onShareCreated: () => void;
}

export function PhotoLibraryToolbar({
  selectedIds,
  onClearSelection,
  onShareCreated,
}: PhotoLibraryToolbarProps) {
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createSharePack() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/photos/share-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoIds: selectedIds,
          title: `Photo pack (${selectedIds.length})`,
          packType: 'manual',
          filenamePrefix: 'Photo',
        }),
      });
      const data = (await res.json()) as { shareUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Share pack failed');
      setShareUrl(data.shareUrl ?? null);
      onShareCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share pack failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
  }

  async function analyzeSelected() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/photos/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoIds: selectedIds.slice(0, 10) }),
      });
      const data = (await res.json()) as { error?: string; enqueued?: number };
      if (!res.ok) throw new Error(data.error || 'Analyze enqueue failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyze enqueue failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-sm text-muted-foreground">
        {selectedIds.length} selected
      </span>
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={selectedIds.length === 0 || busy}
        onClick={analyzeSelected}
      >
        Analyze selected
      </button>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        disabled={selectedIds.length === 0 || busy}
        onClick={createSharePack}
      >
        {busy ? 'Creating…' : 'Create share pack'}
      </button>
      {shareUrl ? (
        <>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={copyShareUrl}
          >
            Copy link
          </button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
            Open share page
          </a>
        </>
      ) : null}
      {selectedIds.length > 0 ? (
        <button type="button" className="text-sm text-muted-foreground underline" onClick={onClearSelection}>
          Clear
        </button>
      ) : null}
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
