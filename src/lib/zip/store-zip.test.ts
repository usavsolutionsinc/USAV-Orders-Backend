import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoreZip } from './store-zip';

// ─── The extraction invariant ─────────────────────────────────────────────────
// Every central-directory record must point at the true byte offset of its
// entry's local header. The previous per-route builders wrote 0 for every
// entry, which extracts fine for a single-file archive (offset really is 0)
// and corrupts every multi-file archive — the exact "zip won't extract" bug.

const FIXED_DATE = new Date('2026-07-05T12:00:00');

function entriesOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `photo_${i + 1}.jpg`,
    data: Buffer.from(`payload-${i + 1}-`.repeat(10 + i)),
  }));
}

/** Walk the EOCD + central directory the way an extractor does. */
function readCentralDirectory(zip: Buffer) {
  const eocd = zip.subarray(zip.length - 22);
  assert.equal(eocd.readUInt32LE(0), 0x06054b50, 'EOCD signature');
  const count = eocd.readUInt16LE(10);
  const cdSize = eocd.readUInt32LE(12);
  const cdStart = eocd.readUInt32LE(16);
  assert.equal(cdStart + cdSize + 22, zip.length, 'EOCD offsets span the file exactly');

  const records: Array<{ name: string; localOffset: number; size: number; crc: number }> = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50, `central record ${i} signature`);
    const nameLen = zip.readUInt16LE(p + 28);
    records.push({
      name: zip.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      localOffset: zip.readUInt32LE(p + 42),
      size: zip.readUInt32LE(p + 24),
      crc: zip.readUInt32LE(p + 16),
    });
    p += 46 + nameLen;
  }
  return records;
}

test('multi-entry archive: every central record points at a real local header', () => {
  const entries = entriesOf(3);
  const zip = buildStoreZip(entries, FIXED_DATE);
  const records = readCentralDirectory(zip);

  assert.equal(records.length, 3);
  const offsets = records.map((r) => r.localOffset);
  assert.equal(new Set(offsets).size, 3, 'offsets must be distinct (regression: all were 0)');

  for (const [i, record] of records.entries()) {
    assert.equal(zip.readUInt32LE(record.localOffset), 0x04034b50, `entry ${i} local signature at claimed offset`);
    const nameLen = zip.readUInt16LE(record.localOffset + 26);
    const name = zip.subarray(record.localOffset + 30, record.localOffset + 30 + nameLen).toString('utf8');
    assert.equal(name, entries[i].name, `entry ${i} local header names the right file`);
    const data = zip.subarray(record.localOffset + 30 + nameLen, record.localOffset + 30 + nameLen + record.size);
    assert.deepEqual(data, entries[i].data, `entry ${i} STORE payload sits right after its local header`);
  }
});

test('single-entry archive still starts at offset 0', () => {
  const zip = buildStoreZip(entriesOf(1), FIXED_DATE);
  const [record] = readCentralDirectory(zip);
  assert.equal(record.localOffset, 0);
});

test('empty archive is a bare EOCD', () => {
  const zip = buildStoreZip([], FIXED_DATE);
  assert.equal(zip.length, 22);
  assert.equal(readCentralDirectory(zip).length, 0);
});
