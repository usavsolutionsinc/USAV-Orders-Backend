import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildJourneyCsv,
  buildJourneyPrintHtml,
  buildSerialJourneyHref,
  serialJourneyFilters,
} from '@/lib/serial/serial-journey';
import type { TimelineItem } from '@/lib/timeline/types';

const FIXED = new Date('2026-06-27T18:00:00.000Z');

const ITEMS: TimelineItem[] = [
  {
    id: 'inv:1',
    at: '2026-06-25T14:00:00.000Z',
    title: 'Shipped',
    tone: 'success',
    subtitle: 'LABELED → SHIPPED',
    actor: 'Maria G.',
    ref: { value: 'SN-ABC-12345', kind: 'serial' },
  },
  {
    id: 'inv:2',
    at: '2026-06-20T09:30:00.000Z',
    title: 'Received',
    subtitle: 'Note with a comma, and "quotes"',
    actor: 'Sam',
    ref: { value: 'SN-ABC-12345', kind: 'serial' },
  },
];

test('serialJourneyFilters builds a serial-dimension focused filter', () => {
  const f = serialJourneyFilters('  SN-ABC-12345  ');
  assert.equal(f.dim, 'serial');
  assert.equal(f.serial, 'SN-ABC-12345');
  assert.equal(f.order, null);
  assert.equal(f.tracking, null);
  assert.deepEqual(f.stations, []);
});

test('serialJourneyFilters maps an empty serial to null (browse-safe)', () => {
  assert.equal(serialJourneyFilters('   ').serial, null);
});

test('buildSerialJourneyHref deep-links into History mode on the serial dim', () => {
  const href = buildSerialJourneyHref('SN ABC/123');
  assert.match(href, /^\/operations\?/);
  const qs = new URLSearchParams(href.split('?')[1]);
  assert.equal(qs.get('mode'), 'history');
  assert.equal(qs.get('dim'), 'serial');
  assert.equal(qs.get('serial'), 'SN ABC/123'); // URLSearchParams handles encoding
});

test('buildJourneyCsv emits a header block, column row, and one line per event', () => {
  const csv = buildJourneyCsv('SN-ABC-12345', ITEMS, FIXED);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Journey,SN-ABC-12345');
  assert.equal(lines[1], `Exported,${FIXED.toISOString()}`);
  assert.equal(lines[2], 'Events,2');
  assert.equal(lines[3], '');
  assert.equal(lines[4], 'Timestamp (ISO),Local time,Event,Detail,Actor,Reference');
  // 5 header/blank/column lines + 2 data rows
  assert.equal(lines.length, 7);
});

test('buildJourneyCsv quotes/escapes cells containing commas and quotes', () => {
  const csv = buildJourneyCsv('SN-ABC-12345', ITEMS, FIXED);
  // The "Received" row's subtitle has a comma + embedded quotes → must be quoted + doubled.
  assert.ok(csv.includes('"Note with a comma, and ""quotes"""'));
  // The serial ref renders as kind:value.
  assert.ok(csv.includes('serial:SN-ABC-12345'));
});

test('buildJourneyCsv tolerates a null timestamp', () => {
  const csv = buildJourneyCsv('SN-X', [{ id: 1, at: null, title: 'Listed' }], FIXED);
  const dataRow = csv.split('\n').at(-1)!;
  assert.ok(dataRow.startsWith(',')); // empty ISO + empty local time
  assert.ok(dataRow.includes('Listed'));
});

test('buildJourneyPrintHtml escapes HTML and includes one row per event', () => {
  const html = buildJourneyPrintHtml('SN-ABC-12345', ITEMS, FIXED);
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes('Serial journey — SN-ABC-12345'));
  assert.ok(html.includes('2 events'));
  // The embedded quotes in the subtitle must be HTML-escaped.
  assert.ok(html.includes('&quot;quotes&quot;'));
  // one <tr> per data row, plus the single thead header row.
  assert.equal((html.match(/<tr>/g) ?? []).length, ITEMS.length + 1);
});
