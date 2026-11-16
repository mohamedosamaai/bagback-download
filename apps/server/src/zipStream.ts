import { PassThrough } from 'stream';

export interface ZipInputEntry {
  name: string;
  createStream: () => NodeJS.ReadableStream;
}

interface CentralDirRecord {
  nameBuf: Buffer;
  crc: number;
  size: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, buf: Buffer): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function sanitizeZipEntryName(raw: string, used: Set<string>, index: number): string {
  const cleanBase = (raw || `track-${index + 1}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || `track-${index + 1}`;

  const extIdx = cleanBase.lastIndexOf('.');
  const stem = extIdx > 0 ? cleanBase.slice(0, extIdx) : cleanBase;
  const ext = extIdx > 0 ? cleanBase.slice(extIdx) : '';

  let candidate = cleanBase;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n++})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function writeChunk(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  if (!stream.write(buf)) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        stream.off('drain', onDrain);
        stream.off('error', onError);
      };
      stream.once('drain', onDrain);
      stream.once('error', onError);
    });
  }
}

/**
 * Streams multiple entries into a valid UTF-8 ZIP archive (STORE mode, zero extra dependencies)
 * so already-compressed MP3/MP4 files pack at network line speed with constant memory overhead.
 */
export async function streamFilesToZip(
  entries: ZipInputEntry[],
  dest: NodeJS.WritableStream
): Promise<{ totalBytes: number; entryCount: number }> {
  const usedNames = new Set<string>();
  const centralRecords: CentralDirRecord[] = [];
  const { dosTime, dosDate } = toDosTimeDate(new Date());
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const safeName = sanitizeZipEntryName(entries[i].name, usedNames, i);
    const nameBuf = Buffer.from(safeName, 'utf8');
    const localHeaderOffset = offset;

    // Local File Header: Data Descriptor bit (0x0008) + UTF-8 filename bit (0x0800)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // Version needed 2.0
    lfh.writeUInt16LE(0x0808, 6); // UTF-8 + Data Descriptor
    lfh.writeUInt16LE(0, 8); // Compression: STORE (0)
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(0, 14); // CRC in descriptor
    lfh.writeUInt32LE(0, 18); // Compressed size in descriptor
    lfh.writeUInt32LE(0, 22); // Uncompressed size in descriptor
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    await writeChunk(dest, lfh);
    await writeChunk(dest, nameBuf);
    offset += lfh.length + nameBuf.length;

    let crc = 0;
    let size = 0;
    const srcStream = entries[i].createStream();
    for await (const rawChunk of srcStream as AsyncIterable<Buffer | Uint8Array | string>) {
      const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      if (buf.length === 0) continue;
      crc = updateCrc32(crc, buf);
      size += buf.length;
      await writeChunk(dest, buf);
      offset += buf.length;
    }

    // Data Descriptor (PK\x07\x08)
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(size >>> 0, 8);
    dd.writeUInt32LE(size >>> 0, 12);
    await writeChunk(dest, dd);
    offset += dd.length;

    centralRecords.push({
      nameBuf,
      crc: crc >>> 0,
      size: size >>> 0,
      localHeaderOffset,
      dosTime,
      dosDate,
    });
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;

  for (const rec of centralRecords) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // Version made by
    cd.writeUInt16LE(20, 6); // Version needed
    cd.writeUInt16LE(0x0808, 8); // UTF-8 + Data Descriptor
    cd.writeUInt16LE(0, 10); // STORE
    cd.writeUInt16LE(rec.dosTime, 12);
    cd.writeUInt16LE(rec.dosDate, 14);
    cd.writeUInt32LE(rec.crc, 16);
    cd.writeUInt32LE(rec.size, 20);
    cd.writeUInt32LE(rec.size, 24);
    cd.writeUInt16LE(rec.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(rec.localHeaderOffset >>> 0, 42);

    await writeChunk(dest, cd);
    await writeChunk(dest, rec.nameBuf);
    centralDirSize += cd.length + rec.nameBuf.length;
    offset += cd.length + rec.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralDirSize >>> 0, 12);
  eocd.writeUInt32LE(centralDirOffset >>> 0, 16);
  eocd.writeUInt16LE(0, 20);

  await writeChunk(dest, eocd);
  offset += eocd.length;

  await new Promise<void>((resolve, reject) => {
    dest.once('error', reject);
    dest.end(() => resolve());
  });

  return { totalBytes: offset, entryCount: centralRecords.length };
}

/** Creates a PassThrough ZIP stream cleanly when piping direct without pre-buffering. */
export function createZipPassThrough(entries: ZipInputEntry[]): PassThrough {
  const pass = new PassThrough();
  void streamFilesToZip(entries, pass).catch((err) => {
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  return pass;
}
