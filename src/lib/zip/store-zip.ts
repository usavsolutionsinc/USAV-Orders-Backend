/**
 * Minimal STORE-method (no compression) ZIP builder — the single writer behind
 * every "download as .zip" route (photos, share packs, outbound documents).
 *
 * History: three routes each carried a copy-pasted builder whose central
 * directory wrote 0 for every entry's "relative offset of local header"
 * (byte 42), so any archive with ≥2 files failed to extract (macOS Archive
 * Utility errors out; `unzip` reports overlapping entries). This module tracks
 * the real local-header offset per entry. Entries are buffered in memory, so
 * callers should keep per-request entry counts bounded (the documents route
 * caps at 50).
 */

export interface StoreZipEntry {
  /** Entry filename as it should appear in the archive (UTF-8). */
  name: string;
  data: Buffer;
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** MS-DOS date/time pair (what ZIP headers store); floors to 2-second precision. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** General-purpose flag bit 11: entry names are UTF-8 encoded. */
const FLAG_UTF8_NAMES = 0x0800;

/**
 * Build a complete, extractable ZIP archive (STORE method) from in-memory
 * entries. Central-directory records carry the true local-header offsets.
 */
export function buildStoreZip(entries: StoreZipEntry[], now: Date = new Date()): Buffer<ArrayBuffer> {
  const { time, date } = dosDateTime(now);
  const parts: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { data } = entry;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);

    parts.push(local, data);
    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(centralHeaders.length, 8);
  end.writeUInt16LE(centralHeaders.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16); // offset of start of central directory
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralDir, end]);
}
