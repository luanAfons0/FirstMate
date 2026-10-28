/**
 * Make the archive of a Plugin Release from a folder, and the `.sha256`
 * beside it (ADR-0033).
 *
 *   node scripts/plugin-release-archive.ts <folder> <name> <version> <out> [<platform>-<arch>]
 *
 * It writes `<out>/<name>-<version>.tar.gz`, the archive for every platform,
 * or `<out>/<name>-<version>-<platform>-<arch>.tar.gz` when a platform is
 * given, and the archive's SHA-256 beside it in the form `sha256sum` writes.
 * It prints the archive's path. The files of the folder are at the top of the
 * archive, so that `install` lands them straight in the Plugin's directory.
 *
 * The release workflow runs this script, and the tests make their Plugin
 * Releases with it too, so one test proves both sides of the contract: what
 * the workflow makes, `install` reads. That is why the tar is written here, in
 * Node, and not by the system `tar`: GNU tar on the runner and bsdtar on a
 * contributor's Windows write different archives, and the tests must read the
 * same bytes the workflow publishes.
 *
 * It refuses a folder that `install` would refuse, in one sentence and before
 * it writes anything, so the workflow never publishes an archive that every
 * install refuses. The rules are the ones of `readTar` in
 * `packages/core/src/tar.ts`, copied below: the workflow checks out only
 * `scripts/`, so this file cannot import core. Change `tar.ts` and change the
 * copy with it.
 *
 * The archive is the same for the same folder: entries in name order, every
 * time and owner zero. Only the executable bit of a file's mode means
 * anything to `install`, and it is kept as the folder has it.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** A Release Version: `MAJOR.MINOR.PATCH`, as the tag `v<version>` names it. */
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** A Plugin's name and a platform, as they may stand in a file name. */
const NAME = /^[A-Za-z0-9._-]+$/;
const PLATFORM = /^[a-z0-9]+-[a-z0-9]+$/;

/** One block of a tar archive. Every header and every file is padded to it. */
const BLOCK = 512;

/** One entry of the archive, as the folder holds it. */
type Entry =
  | { readonly kind: 'file'; readonly path: string; readonly mode: number; readonly bytes: Buffer }
  | { readonly kind: 'directory'; readonly path: string; readonly mode: number }
  | { readonly kind: 'link'; readonly path: string; readonly target: string };

/** Every entry under this folder, parents before children, in name order. */
async function entriesOf(folder: string, under = ''): Promise<Entry[]> {
  const entries: Entry[] = [];
  const names = (await readdir(join(folder, under))).sort();
  for (const name of names) {
    const path = under === '' ? name : `${under}/${name}`;
    const full = join(folder, path);
    const found = await lstat(full);
    if (found.isSymbolicLink()) {
      entries.push({ kind: 'link', path, target: await readlink(full) });
    } else if (found.isDirectory()) {
      entries.push({ kind: 'directory', path, mode: found.mode });
      entries.push(...(await entriesOf(folder, path)));
    } else if (found.isFile()) {
      entries.push({ kind: 'file', path, mode: found.mode, bytes: await readFile(full) });
    } else {
      throw new Error(`${full} is neither a file, a directory nor a link, so it cannot ship.`);
    }
  }
  return entries;
}

/**
 * FirstMate's record of Release Files, at the top of the Plugin's directory.
 * FirstMate alone writes it, so no archive may hold it. Copied from `tar.ts`.
 */
const RELEASE_RECORD = '.firstmate-release.json';

/** A character no path holds: a control character, or a backslash. Copied from `tar.ts`. */
const UNLANDABLE = /[\p{Cc}\\]/u;

/** A path that starts at a root: `/`, or a Windows drive. Copied from `tar.ts`. */
const ROOTED = /^(?:\/|[A-Za-z]:)/;

/** A target part Windows can read as another name: `NAME~1`, or `name:stream`. Copied from `tar.ts`. */
const ANOTHER_NAME = /~\d|:/;

/**
 * A part of a path by the name every platform knows it by: one Unicode form,
 * one case, no dots or spaces at its end. Copied from `tar.ts`.
 */
function folded(part: string): string {
  return part
    .normalize('NFC')
    .toLowerCase()
    .replace(/[. ]+$/, '');
}

/**
 * Refuse, in one sentence, an entry that `readTar` would refuse: a name that
 * does not land the same on every platform, two names that are one name
 * somewhere, the record of Release Files, or a link that leaves the folder.
 */
function checkEntries(entries: readonly Entry[]): void {
  const refuse = (path: string, why: string): Error =>
    new Error(
      `${shown(path)} is ${why}, so \`install\` would refuse this Plugin Release; ` +
        'rename or remove it in the Release Files.',
    );
  const landed = new Map<string, Entry['kind']>();
  for (const entry of entries) {
    if (UNLANDABLE.test(entry.path)) {
      throw refuse(entry.path, 'a name with a backslash or a control character');
    }
    const parts = entry.path.split('/');
    if (parts.some((part) => /^[. ]+$/.test(part))) {
      throw refuse(entry.path, 'a name made of only dots and spaces');
    }
    const key = parts.map(folded).join('/');
    if (key === RELEASE_RECORD) {
      throw refuse(entry.path, "the name of FirstMate's own record of Release Files");
    }
    if (landed.has(key))
      throw refuse(entry.path, 'a name that another name equals in case or form');
    landed.set(key, entry.kind);
  }
  for (const entry of entries) {
    if (entry.kind === 'link' && !staysInside(entry.path, entry.target, landed)) {
      throw refuse(entry.path, "a link whose target leaves the Release Files' folder");
    }
  }
}

/**
 * Whether a link at this path, to this target, stays inside the folder: walked
 * one part at a time, refused once it climbs above the top or goes on past
 * another link. Copied from `tar.ts`.
 */
function staysInside(
  path: string,
  target: string,
  landed: ReadonlyMap<string, Entry['kind']>,
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

/** A path as a sentence may hold it: control characters written as \`\\uXXXX\`. */
function shown(path: string): string {
  if (!/\p{Cc}/u.test(path)) return path;
  const escaped = path.replace(
    /\p{Cc}/gu,
    (control) => `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `"${escaped}"`;
}

/**
 * The tar of these entries: a ustar header for each, and a pax header before
 * any whose path or link target does not fit the ustar fields.
 */
function tarOf(entries: readonly Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const path = entry.kind === 'directory' ? `${entry.path}/` : entry.path;
    const target = entry.kind === 'link' ? entry.target : '';
    const long: Record<string, string> = {};
    if (Buffer.byteLength(path) > 100) long['path'] = path;
    if (Buffer.byteLength(target) > 100) long['linkpath'] = target;
    if (Object.keys(long).length > 0) {
      const records = paxRecords(long);
      blocks.push(header('PaxHeader', 0o644, records.length, 'x', ''), padded(records));
    }
    const bytes = entry.kind === 'file' ? entry.bytes : Buffer.alloc(0);
    const mode = entry.kind === 'link' ? 0o777 : entry.mode & 0o777;
    const type = entry.kind === 'file' ? '0' : entry.kind === 'directory' ? '5' : '2';
    blocks.push(header(path, mode, bytes.length, type, target), padded(bytes));
  }
  // Two empty blocks end an archive.
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

/** Pax records, each `<length> <key>=<value>\n`, the length counting itself. */
function paxRecords(values: Readonly<Record<string, string>>): Buffer {
  let text = '';
  for (const [key, value] of Object.entries(values)) {
    const rest = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(rest) + 1;
    while (`${length}`.length + Buffer.byteLength(rest) !== length) length += 1;
    text += `${length}${rest}`;
  }
  return Buffer.from(text);
}

/** One ustar header block. A field too long for it is cut, and a pax header says it whole. */
function header(path: string, mode: number, size: number, type: string, target: string): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(path.slice(0, 100), 0, 100, 'utf8');
  block.write(octal(mode, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.write(type, 156, 'ascii');
  block.write(target.slice(0, 100), 157, 100, 'utf8');
  block.write('ustar\u000000', 257, 'ascii');
  // The checksum is summed with its own field read as spaces.
  block.fill(' ', 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');
  return block;
}

/** A number in octal, as wide as its field allows, ended by a NUL. */
function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\u0000`;
}

/** The bytes, padded with zeros to a whole number of blocks. */
function padded(bytes: Buffer): Buffer {
  const rest = bytes.length % BLOCK;
  return rest === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(BLOCK - rest)]);
}

/** Make the archive and its `.sha256`, and give back the archive's path. */
async function archive(argv: readonly string[]): Promise<string> {
  const [folder, name, version, out, platform, ...more] = argv;
  if (folder === undefined || name === undefined || version === undefined || out === undefined) {
    throw new Error(
      'Give a folder, a name, a version and an out folder: ' +
        'plugin-release-archive.ts <folder> <name> <version> <out> [<platform>-<arch>]',
    );
  }
  if (more.length > 0) throw new Error(`${more.join(' ')} is more than the script takes.`);
  if (!NAME.test(name)) throw new Error(`${name} cannot stand in a file name.`);
  if (!VERSION.test(version)) throw new Error(`${version} is not MAJOR.MINOR.PATCH.`);
  if (platform !== undefined && !PLATFORM.test(platform)) {
    throw new Error(`${platform} is not <platform>-<arch>, such as linux-x64.`);
  }

  const entries = await entriesOf(resolve(folder));
  if (entries.length === 0) throw new Error(`${folder} is empty, so there is nothing to ship.`);
  checkEntries(entries);
  const bytes = gzipSync(tarOf(entries), { level: 9 });
  const file = `${name}-${version}${platform === undefined ? '' : `-${platform}`}.tar.gz`;
  await mkdir(out, { recursive: true });
  const path = join(resolve(out), file);
  await writeFile(path, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(`${path}.sha256`, `${hash}  ${file}\n`);
  return path;
}

try {
  console.log(await archive(process.argv.slice(2)));
} catch (fault) {
  process.stderr.write(`${fault instanceof Error ? fault.message : String(fault)}\n`);
  process.exitCode = 1;
}
