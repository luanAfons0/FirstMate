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
 * It writes nothing, and it refuses the whole archive for any entry that could
 * land outside the Plugin's directory, land through a link, or fake
 * FirstMate's record of Release Files. A path is checked as every platform
 * reads it: Windows takes a backslash for a separator, `C:` for a drive,
 * and drops the dots and spaces at the end of a name; Windows and macOS do
 * not tell names apart by case. So a path holds no `..`, is not absolute and
 * holds no backslash. No entry lies under a link or a file, or has the path
 * of another entry, because a link in its way would carry it somewhere else
 * and the record would name a file that is not where it says. A link's
 * target stays inside the Plugin's directory and climbs through no other
 * link, because a link to `.` with `..` after it is the Shelf.
 */
import { gunzipSync } from 'node:zlib';
import { refuse } from './refusal.ts';

/** One block of a tar archive. Every header and every file is padded to it. */
const BLOCK = 512;

/**
 * FirstMate's record of Release Files, at the top of the Plugin's directory.
 * FirstMate alone writes it, so no archive may hold it (ADR-0033).
 */
const RELEASE_RECORD = '.firstmate-release.json';

/** A character no path of an entry holds: a control character, or a backslash. */
const UNLANDABLE = /[\p{Cc}\\]/u;

/** A path that starts at a root: `/`, or a Windows drive, `C:` with or without a `/`. */
const ROOTED = /^(?:\/|[A-Za-z]:)/;

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

  const hostile = (path: string, why: string): Error =>
    refuse(
      'invalid',
      `${from} holds ${shown(path)}, ${why}, so nothing was unpacked; ` +
        `ask the Plugin's author to ship the Plugin Release without it.`,
    );

  const entries: TarEntry[] = [];
  // What each path already is, by the name every platform knows it by, and
  // the directories that lead to it.
  const landed = new Map<string, TarEntry['kind']>();
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

    const raw = next.path ?? fullName(header);
    const target = next.target ?? textAt(header, 157, 100);
    next = {};
    if (UNLANDABLE.test(raw) || ROOTED.test(raw)) {
      throw hostile(
        raw,
        "a path that does not land inside the Plugin's directory on every platform",
      );
    }
    const parts = partsOf(raw);
    if (parts === undefined) throw hostile(raw, "a path that climbs out of the Plugin's directory");
    const path = parts.join('/');
    // The archive's own top, `./`, is the Plugin's directory itself.
    if (path === '') continue;

    let kind: TarEntry['kind'];
    if (type === '0' || type === '\u0000' || type === '7') kind = 'file';
    else if (type === '5') kind = 'directory';
    else if (type === '2') kind = 'link';
    else throw hostile(raw, 'which is neither a file, a directory nor a link');

    const key = parts.map(folded);
    if (key.join('/') === RELEASE_RECORD) {
      throw hostile(raw, "the name of FirstMate's own record of Release Files");
    }
    for (let depth = 1; depth < key.length; depth += 1) {
      const above = key.slice(0, depth).join('/');
      const what = landed.get(above);
      if (what === 'link') throw hostile(raw, 'which would be written through a link');
      if (what === 'file') throw hostile(raw, 'which would be written under a file');
      landed.set(above, 'directory');
    }
    const before = landed.get(key.join('/'));
    if (before !== undefined && !(before === 'directory' && kind === 'directory')) {
      throw hostile(raw, 'a path the archive holds twice');
    }
    landed.set(key.join('/'), kind);

    if (kind === 'file') {
      const mode = numberAt(header, 100, 8) ?? 0o644;
      entries.push({ kind, path, mode, bytes: Buffer.from(body) });
    } else if (kind === 'directory') {
      entries.push({ kind, path });
    } else {
      entries.push({ kind, path, target });
    }
  }

  // Every link is checked once the whole archive is read, because the link a
  // target climbs through can come after it.
  for (const entry of entries) {
    if (entry.kind === 'link' && !staysInside(entry.path, entry.target, landed)) {
      throw hostile(entry.path, "a link whose target leaves the Plugin's directory");
    }
  }
  return entries;
}

/**
 * The parts of an entry's path with no `.` and no empty part, so `./web/` is
 * `web`, or nothing when a part climbs: `..`, or a part of only dots and
 * spaces, which Windows reads as `..` or as nothing once it drops them.
 */
function partsOf(raw: string): string[] | undefined {
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (/^[. ]+$/.test(part)) return undefined;
    parts.push(part);
  }
  return parts;
}

/**
 * A part of a path by the name every platform knows it by: in one Unicode
 * form, in one case, and with no dots or spaces at its end, as Windows reads
 * it. Two entries with the same folded path are one file somewhere.
 */
function folded(part: string): string {
  return part
    .normalize('NFC')
    .toLowerCase()
    .replace(/[. ]+$/, '');
}

/**
 * A target part Windows can read as another name: `NAME~1`, the short name
 * it may give a long one, or `name:stream`. Either could reach a link of the
 * archive by a name the walk below does not know it by.
 */
const ANOTHER_NAME = /~\d|:/;

/**
 * Whether a link at this path, to this target, stays inside the Plugin's
 * directory. The target is walked one part at a time from the link's own
 * directory, and refused once it climbs above the top, or goes on past
 * another link of the archive, whose own target would decide where it is.
 */
function staysInside(
  path: string,
  target: string,
  landed: ReadonlyMap<string, TarEntry['kind']>,
): boolean {
  if (target === '' || UNLANDABLE.test(target) || ROOTED.test(target)) return false;
  if (ANOTHER_NAME.test(target)) return false;
  const at = path.split('/').map(folded).slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (landed.get(at.join('/')) === 'link') return false;
    if (part === '..') {
      if (at.pop() === undefined) return false;
    } else if (/^[. ]+$/.test(part)) {
      return false;
    } else {
      at.push(folded(part));
    }
  }
  return true;
}

/**
 * A path as a sentence may hold it: as it is, or quoted with each control
 * character written as `\uXXXX`, so a name cannot move the terminal's cursor.
 */
function shown(path: string): string {
  if (!/\p{Cc}/u.test(path)) return path;
  const escaped = path.replace(
    /\p{Cc}/gu,
    (control) => `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `"${escaped}"`;
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
