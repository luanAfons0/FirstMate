/**
 * Read the archive of a Plugin Release: gzipped tar, into a list of entries,
 * with Node's own `zlib` and no dependency (ADR-0033).
 *
 * It reads what the archive script writes, ustar with a pax header where a
 * path is long, and what GNU tar, bsdtar and `git archive` write: a pax
 * global header, and GNU's long-name entries. It gives back regular files,
 * directories and symbolic links, and refuses every other kind of entry,
 * because nothing else belongs in a Plugin's directory.
 *
 * It writes nothing. Where an entry may land is decided by whoever writes the
 * entries, and nothing here is trusted to have checked it.
 */
import { gunzipSync } from 'node:zlib';
import { refuse } from './refusal.ts';

/** One block of a tar archive. Every header and every file is padded to it. */
const BLOCK = 512;

/** One entry of an archive. A path is relative, with `/` between its parts. */
export type TarEntry =
  | {
      readonly kind: 'file';
      readonly path: string;
      /** The mode the archive gives the file. Its executable bit is what counts. */
      readonly mode: number;
      readonly bytes: Buffer;
    }
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string };

/**
 * Every entry of this gzipped tar, in the archive's order. An archive that
 * cannot be read is refused in a sentence that names `from`.
 */
export function readTar(gzipped: Buffer, from: string): TarEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzipped);
  } catch (cause) {
    throw refuse('invalid', `${from} is not a gzipped archive, so nothing was unpacked.`, {
      cause,
    });
  }
  const broken = (why: string): Error =>
    refuse('invalid', `${from} is a broken tar archive: ${why}. Nothing was unpacked.`);

  const entries: TarEntry[] = [];
  // What a pax or GNU header says about the entry after it, and only that one.
  let next: { path?: string; target?: string; size?: number } = {};
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    // An empty block ends the archive.
    if (header.every((byte) => byte === 0)) break;
    if (!checksumHolds(header)) throw broken(`the header at byte ${at} has a wrong checksum`);

    const size = next.size ?? numberAt(header, 124, 12);
    if (size === undefined) throw broken(`the header at byte ${at} has no size`);
    const start = at + BLOCK;
    if (start + size > tar.length) throw broken(`the entry at byte ${at} is cut short`);
    const body = tar.subarray(start, start + size);
    at = start + Math.ceil(size / BLOCK) * BLOCK;

    const type = String.fromCharCode(header[156] ?? 0);
    if (type === 'x') {
      next = { ...next, ...paxOf(body) };
      continue;
    }
    if (type === 'g') continue; // `git archive` puts its commit here; nothing lands from it.
    if (type === 'L') {
      next = { ...next, path: textOf(body) };
      continue;
    }
    if (type === 'K') {
      next = { ...next, target: textOf(body) };
      continue;
    }

    const path = pathOf(next.path ?? fullName(header));
    const target = next.target ?? textAt(header, 157, 100);
    next = {};
    // The archive's own top, `./`, is the Plugin's directory itself.
    if (path === '') continue;
    if (type === '0' || type === '\u0000' || type === '7') {
      const mode = numberAt(header, 100, 8) ?? 0o644;
      entries.push({ kind: 'file', path, mode, bytes: Buffer.from(body) });
    } else if (type === '5') {
      entries.push({ kind: 'directory', path });
    } else if (type === '2') {
      entries.push({ kind: 'link', path, target });
    } else {
      throw refuse(
        'invalid',
        `${from} holds ${path}, which is neither a file, a directory nor a link. ` +
          `Nothing was unpacked; ask the Plugin's author to ship it without it.`,
      );
    }
  }
  return entries;
}

/** Whether the header's checksum is the sum of its bytes, its own field read as spaces. */
function checksumHolds(header: Buffer): boolean {
  const recorded = numberAt(header, 148, 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return recorded === sum;
}

/** A ustar path: the prefix and the name, joined, when there is a prefix. */
function fullName(header: Buffer): string {
  const name = textAt(header, 0, 100);
  const magic = header.subarray(257, 262).toString('latin1');
  const prefix = magic === 'ustar' ? textAt(header, 345, 155) : '';
  return prefix === '' ? name : `${prefix}/${name}`;
}

/** A path with no `./` before it and no `/` after it, so `./web/` is `web`. */
function pathOf(raw: string): string {
  let path = raw;
  while (path.startsWith('./')) path = path.slice(2);
  if (path === '.') return '';
  return path.replace(/\/+$/, '');
}

/** The pax records `path`, `linkpath` and `size`; any other is not needed to land a file. */
function paxOf(body: Buffer): { path?: string; target?: string; size?: number } {
  const said: { path?: string; target?: string; size?: number } = {};
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    const length = Number(body.subarray(at, space).toString('ascii'));
    if (space < 0 || !Number.isSafeInteger(length) || length <= 0) break;
    const record = body.subarray(space + 1, at + length - 1).toString('utf8');
    at += length;
    const equals = record.indexOf('=');
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (key === 'path') said.path = value;
    else if (key === 'linkpath') said.target = value;
    else if (key === 'size' && /^\d+$/.test(value)) said.size = Number(value);
  }
  return said;
}

/** Text up to its first NUL. */
function textOf(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
}

function textAt(header: Buffer, start: number, length: number): string {
  return textOf(header.subarray(start, start + length));
}

/**
 * A number field: octal text, or GNU's base-256 for a number too big for it,
 * which sets the field's first bit.
 */
function numberAt(header: Buffer, start: number, length: number): number | undefined {
  const field = header.subarray(start, start + length);
  if (((field[0] ?? 0) & 0x80) !== 0) {
    let value = (field[0] ?? 0) & 0x7f;
    for (const byte of field.subarray(1)) value = value * 256 + byte;
    return Number.isSafeInteger(value) ? value : undefined;
  }
  const text = textOf(field).trim();
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : undefined;
}
