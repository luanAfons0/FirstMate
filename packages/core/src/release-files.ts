/**
 * The Release Files of a Plugin Release, and FirstMate's record of them
 * (ADR-0033).
 *
 * A Plugin Release is unpacked into a directory of its own, and FirstMate
 * writes beside its files `.firstmate-release.json`: the SHA-256 of every
 * file, and the target of every symbolic link, by its path in the Plugin. It
 * lists no directories. FirstMate alone writes it, so that `update` can tell
 * a Release File from the Plugin's own data: whatever the record does not
 * name is data, and `update` does not touch it.
 *
 * Install and update unpack the same way, so a Plugin updated to a Plugin
 * Release holds what one installed from it holds.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { refuse } from './refusal.ts';
import type { TarEntry } from './tar.ts';

/** The name of FirstMate's record of Release Files, in the Plugin's directory. */
export const RELEASE_RECORD = '.firstmate-release.json';

/** FirstMate's record of the Release Files of one Plugin Release. */
export type ReleaseRecord = {
  /** Each file's SHA-256, by its path in the Plugin, with `/` between its parts. */
  readonly files: Readonly<Record<string, string>>;
  /** Each symbolic link's target, by its path in the Plugin. Left out when there is none. */
  readonly links?: Readonly<Record<string, string>>;
};

/** What an unpacked Plugin Release holds: its record, and the directories it made. */
export type Unpacked = {
  readonly record: ReleaseRecord;
  /** Every directory the archive names or a Release File needs, by its path in the Plugin. */
  readonly directories: readonly string[];
};

/**
 * Every path a record names, files and links: the Release Files. The record
 * itself is not among them.
 */
export function releaseFilesOf(record: ReleaseRecord): string[] {
  return [...Object.keys(record.files), ...Object.keys(record.links ?? {})];
}

/**
 * Unpack these entries into a new directory, then write the record of them
 * there, and give back what it holds. The Release Files land first, so a
 * directory with a record in it is a whole Plugin Release.
 */
export async function unpackRelease(
  entries: readonly TarEntry[],
  directory: string,
): Promise<Unpacked> {
  const files: Record<string, string> = {};
  const links: Record<string, string> = {};
  const directories = new Set<string>();
  await mkdir(directory);
  for (const entry of entries) {
    const path = join(directory, entry.path);
    if (entry.kind === 'directory') {
      await mkdir(path, { recursive: true });
      directories.add(entry.path.replace(/\/+$/, ''));
      continue;
    }
    for (let up = parentOf(entry.path); up !== ''; up = parentOf(up)) directories.add(up);
    await mkdir(dirname(path), { recursive: true });
    if (entry.kind === 'link') {
      await symlink(entry.target, path);
      links[entry.path] = entry.target;
      continue;
    }
    // Only the executable bit is the archive's to give. The rest is the
    // usual, so a Plugin Release cannot land a file anyone may write to.
    // `wx` makes every file new: the tar reader refuses an archive that
    // would write over an entry or through a link, and this keeps it so.
    await writeFile(path, entry.bytes, {
      mode: (entry.mode & 0o111) === 0 ? 0o644 : 0o755,
      flag: 'wx',
    });
    files[entry.path] = createHash('sha256').update(entry.bytes).digest('hex');
  }
  const record: ReleaseRecord =
    Object.keys(links).length === 0
      ? { files: sorted(files) }
      : { files: sorted(files), links: sorted(links) };
  await writeFile(join(directory, RELEASE_RECORD), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'wx',
  });
  return { record, directories: [...directories].sort() };
}

/**
 * The record of Release Files in a Plugin's directory, or the refusal that
 * says it is missing or is not one FirstMate wrote.
 */
export async function readReleaseRecord(directory: string): Promise<ReleaseRecord> {
  const path = join(directory, RELEASE_RECORD);
  const notOurs = (cause?: unknown): Error =>
    refuse(
      'invalid',
      `${path} is not FirstMate's record of Release Files, so update cannot tell them ` +
        "from the Plugin's data: move the data out, then remove the Plugin and install it again.",
      { cause },
    );
  let read: unknown;
  try {
    read = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw notOurs(cause);
  }
  const { files, links } = (read ?? {}) as Record<string, unknown>;
  if (!isTextMap(files) || (links !== undefined && !isTextMap(links))) throw notOurs();
  return links === undefined ? { files } : { files, links };
}

/** Whether a value read from JSON is an object of text values. */
function isTextMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((one) => typeof one === 'string')
  );
}

/** The directory a path in the Plugin is in, or nothing at the top. */
export function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

/** The same map, in path order, so the record reads the same for the same files. */
function sorted(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
}
