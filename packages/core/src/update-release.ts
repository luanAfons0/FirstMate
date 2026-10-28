/**
 * Updating a Plugin installed from a Plugin Release: take the newest Plugin
 * Release in the same MAJOR, and put its Release Files where the old ones
 * were (ADR-0033).
 *
 * The steps run in this order, each one a function of its own:
 *
 * 1. `nextRelease` asks GitHub for the Plugin Releases, and picks the one to take.
 * 2. `stage` downloads, checks and unpacks it into `.<name>.pending` in the Shelf.
 * 3. `planMoves` writes down, as data, every rename the update is made of:
 *    each old Release File, and the old record, into `.<name>.previous`, then
 *    each new Release File into place, then the new record last.
 * 4. `checkReleaseFiles` and `checkNothingInTheWay` refuse, before any change,
 *    an old Release File that changed or is gone, and the Plugin's data where a
 *    new Release File goes.
 * 5. `applyOrRollBack` does the renames in that order, and when one fails it
 *    undoes those done, newest first. The directories a dropped Release File
 *    leaves empty go then.
 *
 * Every file the old record does not name is the Plugin's data, and no step
 * touches it. Writing the Registry row, restarting the Plugin Server and
 * removing `.<name>.pending` and `.<name>.previous` are the caller's: the row
 * is the Registry's, only a terminal reaches the Host, and on Windows a
 * running `mcp.exe` moved into `.<name>.previous` can be removed only once
 * the Host has stopped it.
 *
 * The moves are a list so that a roll-back reads the same list the update
 * did: it does the moves done so far backwards. The checks read the two
 * records, as a Release File that is gone has no move.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, type Stats } from 'node:fs';
import { mkdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HeldPlugin } from './plugin-places.ts';
import {
  compareVersions,
  downloadPluginRelease,
  pluginReleases,
  type ArchiveTarget,
  type PluginRelease,
} from './plugin-release.ts';
import { refuse } from './refusal.ts';
import {
  parentOf,
  readReleaseRecord,
  RELEASE_RECORD,
  releaseFilesOf,
  unpackRelease,
  type ReleaseRecord,
  type Unpacked,
} from './release-files.ts';
import { readTar } from './tar.ts';

/** Which Plugin Release a Plugin is, as its Registry row says. */
type ReleaseOf = { readonly repository: string; readonly version: string };

/** What an update of a Plugin Release did. */
export type ReleaseMoved = {
  /** The Release Version before the update. */
  readonly from: string;
  /** The Release Version after it. */
  readonly to: string;
  /** The Plugin Release the Registry row is to name now. */
  readonly release: ReleaseOf;
  /** The directories in the Shelf the caller removes once the Plugin Server is restarted. */
  readonly leftBehind: readonly string[];
};

/** One rename of an update, from one path to another, both whole. */
type Move = { readonly from: string; readonly to: string };

/**
 * Move this Plugin to the newest Plugin Release in its MAJOR, and say from
 * which Release Version to which, or give back nothing when it is on the
 * newest already. Nothing is downloaded then, and nothing changes. `target`
 * picks the archive, as it does for install.
 */
export async function updateRelease(
  plugin: HeldPlugin,
  release: ReleaseOf,
  target: ArchiveTarget,
): Promise<ReleaseMoved | undefined> {
  const shelf = dirname(plugin.files);
  const pending = join(shelf, `.${plugin.name}.pending`);
  const previous = join(shelf, `.${plugin.name}.previous`);
  // An update that did not end may have left old Release Files there, and
  // they are the only copy of them.
  if (lstatSync(previous, { throwIfNoEntry: false }) !== undefined) {
    throw refuse(
      'invalid',
      `${previous} is left from an update of ${plugin.name} that did not end: ` +
        'put back what it holds, or take it away, then run update again.',
    );
  }

  const next = await nextRelease(release);
  if (next === undefined) return undefined;
  const old = await readReleaseRecord(plugin.files);
  const unpacked = await stage(next, target, pending);
  try {
    const moves = planMoves(old, unpacked.record, { plugin: plugin.files, pending, previous });
    checkReleaseFiles(plugin.files, old, release.version);
    checkNothingInTheWay(plugin.files, old, unpacked.record, next.version);
    await applyOrRollBack(moves, previous, plugin.name, release.version);
    await removeEmptied(plugin.files, old, unpacked);
  } catch (fault) {
    await rm(pending, { recursive: true, force: true });
    throw fault;
  }
  return {
    from: release.version,
    to: next.version,
    release: { repository: next.repository, version: next.version },
    leftBehind: [pending, previous],
  };
}

/**
 * The Plugin Release to take: the newest with the row's MAJOR, when it is
 * newer than the row's Release Version. A repository GitHub no longer shows
 * is refused, because there is nothing to update from.
 */
async function nextRelease(release: ReleaseOf): Promise<PluginRelease | undefined> {
  const releases = await pluginReleases(release.repository);
  if (releases === undefined) {
    throw refuse(
      'missing',
      `GitHub no longer shows ${release.repository}, so update cannot find its Plugin Releases: ` +
        'check that the repository is still there and public.',
    );
  }
  const major = majorOf(release.version);
  // Newest first, so the first in the same MAJOR is the newest of it.
  const newest = releases.find((one) => majorOf(one.version) === major);
  if (newest === undefined || compareVersions(newest.version, release.version) <= 0) {
    return undefined;
  }
  return newest;
}

/** The MAJOR of a Release Version. */
function majorOf(version: string): string {
  return version.split('.')[0] ?? '';
}

/**
 * Download, check and unpack this Plugin Release's archive for `target` into `pending`, and give
 * back what it holds. One left by an update that failed is taken away first:
 * it holds nothing but a copy of a Plugin Release.
 */
async function stage(
  release: PluginRelease,
  target: ArchiveTarget,
  pending: string,
): Promise<Unpacked> {
  await rm(pending, { recursive: true, force: true });
  try {
    const entries = readTar(await downloadPluginRelease(release, target), release.repository);
    return await unpackRelease(entries, pending);
  } catch (fault) {
    await rm(pending, { recursive: true, force: true });
    throw fault;
  }
}

/**
 * Every rename the update is made of, in order: each old Release File that
 * is there, and the old record, into `previous`; each new Release File into
 * the Plugin's directory; and the new record last, so a Plugin's record
 * changes only once every Release File it names is in place.
 */
function planMoves(
  old: ReleaseRecord,
  now: ReleaseRecord,
  where: { readonly plugin: string; readonly pending: string; readonly previous: string },
): Move[] {
  const out = [...releaseFilesOf(old), RELEASE_RECORD]
    .filter((path) => lstatSync(join(where.plugin, path), { throwIfNoEntry: false }) !== undefined)
    .map((path) => ({ from: join(where.plugin, path), to: join(where.previous, path) }));
  const into = [...releaseFilesOf(now), RELEASE_RECORD].map((path) => ({
    from: join(where.pending, path),
    to: join(where.plugin, path),
  }));
  return [...out, ...into];
}

/**
 * Refuse, before any change, an old Release File that is not as FirstMate put
 * it there: a file with another SHA-256, a symbolic link to another target,
 * or one that is gone. The old Release Files are what a failed update goes
 * back to, and a changed one is the operator's work, which the update would
 * move away and delete.
 */
function checkReleaseFiles(plugin: string, old: ReleaseRecord, version: string): void {
  const putBack = `put back the file of Plugin Release ${version}, then run update again.`;
  const kept = (path: string, as: (found: Stats) => boolean): void => {
    const where = join(plugin, path);
    const found = lstatSync(where, { throwIfNoEntry: false });
    if (found === undefined) {
      throw refuse(
        'invalid',
        `${where} is gone, but it is a Release File, and update needs it to go back to ` +
          `when a move fails: ${putBack}`,
      );
    }
    if (!as(found)) {
      throw refuse(
        'invalid',
        `${where} has changed since FirstMate put it there, and update would delete the change: ` +
          `keep a copy of the change outside the Plugin's directory, ${putBack}`,
      );
    }
  };
  for (const [path, sha256] of Object.entries(old.files)) {
    kept(path, (found) => found.isFile() && hashOf(join(plugin, path)) === sha256);
  }
  for (const [path, target] of Object.entries(old.links ?? {})) {
    kept(path, (found) => found.isSymbolicLink() && readlinkSync(join(plugin, path)) === target);
  }
}

/** A file's SHA-256, as the record of Release Files writes it. */
function hashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Refuse, before any change, the Plugin's data where a new Release File goes:
 * at its path, or at a directory above it, as a file or a symbolic link. A
 * path an old Release File holds is free, as that file moves out first.
 */
function checkNothingInTheWay(
  plugin: string,
  old: ReleaseRecord,
  now: ReleaseRecord,
  version: string,
): void {
  const leaving = new Set(releaseFilesOf(old));
  for (const path of releaseFilesOf(now)) {
    const parts = path.split('/');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const at = parts.slice(0, depth).join('/');
      // What an old Release File holds is free once it moves out, and so is
      // all below it.
      if (leaving.has(at)) break;
      const found = lstatSync(join(plugin, at), { throwIfNoEntry: false });
      if (found === undefined) break;
      if (depth < parts.length && found.isDirectory()) continue;
      throw refuse(
        'invalid',
        `${join(plugin, at)} is the Plugin's data, and Plugin Release ${version} ships ` +
          `${path} there: move it out of the Plugin's directory, then run update again.`,
      );
    }
  }
}

/**
 * Do the moves, and when one fails, undo the ones done, newest first, so the
 * old Release Files are back where they were, the new ones are back in
 * `.<name>.pending`, and the old record still names them. Directories the
 * moves made go too, then `.<name>.previous`, which holds nothing then. When
 * the undo fails as well, `.<name>.previous` is kept, as it holds the only
 * copy of what it could not put back.
 */
async function applyOrRollBack(
  moves: readonly Move[],
  previous: string,
  name: string,
  version: string,
): Promise<void> {
  const done: Move[] = [];
  const made: string[] = [];
  try {
    await applyMoves(moves, done, made);
  } catch (fault) {
    const failed = moves[done.length];
    try {
      for (const move of done.reverse()) await rename(move.to, move.from);
      for (const directory of made.reverse()) await rm(directory, { recursive: true });
      await rm(previous, { recursive: true, force: true });
    } catch (undo) {
      throw new Error(
        `moving ${failed?.from} to ${failed?.to} failed, and so did putting the old ` +
          `Release Files of ${name} back (${messageOf(undo)}): ${previous} holds the ones ` +
          `still missing, so move them back into the Plugin's directory.`,
        { cause: fault },
      );
    }
    throw new Error(
      `moving ${failed?.from} to ${failed?.to} failed (${messageOf(fault)}), so update put the ` +
        `old Release Files of ${name} back, and ${name} is still on ${version}: ` +
        'fix what stopped the move, then run update again.',
      { cause: fault },
    );
  }
}

/** What a fault says, without the stack. */
function messageOf(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}

/**
 * Do the renames in order, each into a directory made for it if it is not
 * there. Each move done goes on `done`, and each directory made on `made`,
 * so a roll-back knows what to undo.
 */
async function applyMoves(moves: readonly Move[], done: Move[], made: string[]): Promise<void> {
  for (const move of moves) {
    const first = await mkdir(dirname(move.to), { recursive: true });
    if (first !== undefined) made.push(first);
    await rename(move.from, move.to);
    done.push(move);
  }
}

/**
 * Make the directories the new Plugin Release names, and remove each one an
 * old Release File was in that is empty now and that the new Plugin Release
 * does not name, deepest first. A directory that holds the Plugin's data is
 * not empty, so it stays.
 */
async function removeEmptied(plugin: string, old: ReleaseRecord, now: Unpacked): Promise<void> {
  for (const directory of now.directories) {
    await mkdir(join(plugin, directory), { recursive: true });
  }
  const kept = new Set(now.directories);
  const emptied = new Set<string>();
  for (const path of releaseFilesOf(old)) {
    for (let up = parentOf(path); up !== '' && !kept.has(up); up = parentOf(up)) emptied.add(up);
  }
  const deepestFirst = [...emptied].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const directory of deepestFirst) {
    await rmdir(join(plugin, directory)).catch((fault: NodeJS.ErrnoException) => {
      if (fault.code !== 'ENOTEMPTY' && fault.code !== 'EEXIST' && fault.code !== 'ENOENT') {
        throw fault;
      }
    });
  }
}
