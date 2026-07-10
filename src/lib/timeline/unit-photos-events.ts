import type { TimelineItem } from './types';

/**
 * Adapter: a unit's photos (testing-scan + receiving-unbox buckets from
 * `listUnitTimelinePhotos`) → `TimelineItem[]`. Each source collapses to ONE row
 * carrying its photos as inline `media` thumbnails, timestamped at the newest
 * capture. Owns the source → title/tone map (never inline in a view), mirroring
 * every other `*ToTimeline` adapter.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */

export interface UnitTimelinePhotoRow {
  photoId: number;
  at: string | null;
  source: 'testing' | 'unbox';
  thumbUrl: string;
  fullUrl: string;
}

const SOURCE_META: Record<UnitTimelinePhotoRow['source'], { title: string; tone: TimelineItem['tone'] }> = {
  testing: { title: 'Testing photos', tone: 'info' },
  unbox: { title: 'Unboxing photos', tone: 'muted' },
};

export function unitPhotosToTimeline(rows: UnitTimelinePhotoRow[]): TimelineItem[] {
  const bySource = new Map<UnitTimelinePhotoRow['source'], UnitTimelinePhotoRow[]>();
  for (const r of rows) {
    const arr = bySource.get(r.source);
    if (arr) arr.push(r);
    else bySource.set(r.source, [r]);
  }

  const items: TimelineItem[] = [];
  for (const [source, list] of bySource) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    const meta = SOURCE_META[source];
    items.push({
      id: `unit-photos-${source}`,
      at: sorted[0]?.at ?? null,
      title: meta.title,
      tone: meta.tone,
      subtitle: `${list.length} photo${list.length === 1 ? '' : 's'}`,
      media: sorted.map((r) => ({ photoId: r.photoId, thumbUrl: r.thumbUrl, fullUrl: r.fullUrl })),
    });
  }
  return items;
}
