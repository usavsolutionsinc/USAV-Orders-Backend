'use client';

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/design-system/primitives';
import { toast } from '@/lib/toast';

interface SharePhoto {
  id: number;
  exportFilename: string | null;
  contentUrl: string;
  thumbUrl: string;
}

interface SharePackPayload {
  pack: {
    title: string;
    poRef: string | null;
    createdAt: string;
    expiresAt: string | null;
  };
  photos: SharePhoto[];
  zipUrl: string;
}

export default function PublicSharePhotosPage({ token }: { token: string }) {
  const [data, setData] = useState<SharePackPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState('');

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/photos/share-packs/${encodeURIComponent(token)}`);
      if (cancelled) return;
      if (res.status === 410) {
        setError('This share link has expired.');
        return;
      }
      if (!res.ok) {
        setError('Share pack not found.');
        return;
      }
      setData((await res.json()) as SharePackPayload);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center">
        <h1 className="text-xl font-semibold">Photos unavailable</h1>
        <p className="mt-2 text-muted-foreground">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center text-muted-foreground">
        Loading photos…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{data.pack.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.photos.length} photo{data.photos.length === 1 ? '' : 's'}
            {data.pack.poRef ? ` · PO ${data.pack.poRef}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex flex-wrap gap-2">
            <a
              href={data.zipUrl}
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Download all (ZIP)
            </a>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                if (!pageUrl) return;
                void navigator.clipboard.writeText(pageUrl).then(
                  () => toast.success('Share link copied'),
                  () => toast.error('Could not copy link'),
                );
              }}
            >
              Copy link
            </Button>
          </div>
          {pageUrl ? (
            <div className="rounded-lg border border-border bg-surface-card p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Scan to open on phone</p>
              <QRCode value={pageUrl} size={96} />
            </div>
          ) : null}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {data.photos.map((photo) => (
          <a
            key={photo.id}
            href={photo.contentUrl}
            target="_blank"
            rel="noreferrer"
            className="aspect-square overflow-hidden rounded-lg border border-border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.thumbUrl} alt={photo.exportFilename || 'Photo'} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </main>
  );
}
