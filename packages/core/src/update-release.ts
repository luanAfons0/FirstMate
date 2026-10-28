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
 * 4. `applyMoves` does the renames in that order, and the directories a dropped
 *    Release File leaves empty go.
 *
 * Every file the old record does not name is the Plugin's data, and no step
 * touches it. Writing the Registry row, restarting the Plugin Server and
 * removing `.<name>.pending` and `.<name>.previous` are the caller's: the row
 * is the Registry's, only a terminal reaches the Host, and on Windows a
 * running `mcp.exe` moved into `.<name>.previous` can be removed only once
 * the Host has stopped it.
 *
 * The moves are a list so that what is checked before any change and what is
 * undone after a failed one read the same list: a check reads where each move
 * goes, and a roll-back does the moves done so far backwards.
 */
import { lstatSync } from 'node:fs';
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
type ReleaseMoved = {
  /** The Release Version before the update. */
  readonly from: string;
  /** The Release Version after it. */
  readonly to: string;
  /** The Plugin Release the Registry row is to name now. */
  readonly release: ReleaseOf;
  /** The directories in the Shelf the caller removes once the Plugin Server is restarted. */
  readonly leftBehind: readonly string[];
};

/**
 * What an update of a Plugin Release found: what it moved, if it moved
 * anything, and the Release Version of a newer MAJOR it left alone.
 */
export type ReleaseUpdate = {
  /** What moved, or nothing when the Plugin was on the Release Version to take already. */
  readonly moved?: ReleaseMoved;
  /** The newest Release Version of a newer MAJOR, which only `--major` takes. */
  readonly ready?: string;
};

/** One rename of an update, from one path to another, both whole. */
type Move = { readonly from: string; readonly to: string };

/**
 * Move this Plugin to the newest Plugin Release in its MAJOR, and say from
 * which Release Version to which, or move nothing when it is on the newest
 * already. Nothing is downloaded then, and nothing changes. With `major` it
 * takes the newest Plugin Release of all. Without it, a newer MAJOR is never
 * taken, and the Release Version of the newest one is given back as `ready`.
 * `target` picks the archive, as it does for install.
 */
export async function updateRelease(
  plugin: HeldPlugin,
  release: ReleaseOf,
  target: ArchiveTarget,
  major = false,
): Promise<ReleaseUpdate> {
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

  const { next, ready } = await nextRelease(release, major);
  if (next === undefined) return { ready };
  const old = await readReleaseRecord(plugin.files);
  const unpacked = await stage(next, target, pending);
  try {
    const moves = planMoves(old, unpacked.record, { plugin: plugin.files, pending, previous });
    await applyMoves(moves);
    await removeEmptied(plugin.files, old, unpacked);
  } catch (fault) {
    await rm(pending, { recursive: true, force: true });
    throw fault;
  }
  return {
    moved: {
      from: release.version,
      to: next.version,
      release: { repository: next.repository, version: next.version },
      leftBehind: [pending, previous],
    },
    ready,
  };
}

/**
 * The Plugin Release to take: the newest with the row's MAJOR, when it is
 * newer than the row's Release Version, or with `major` the newest of all.
 * Beside it, the newest Release Version of a newer MAJOR that was left alone,
 * if there is one. A repository GitHub no longer shows is refused, because
 * there is nothing to update from.
 */
async function nextRelease(
  release: ReleaseOf,
  major: boolean,
): Promise<{ readonly next?: PluginRelease; readonly ready?: string }> {
  const releases = await pluginReleases(release.repository);
  if (releases === undefined) {
    throw refuse(
      'missing',
      `GitHub no longer shows ${release.repository}, so update cannot find its Plugin Releases: ` +
        'check that the repository is still there and public.',
    );
  }
  const now = majorOf(release.version);
  // Newest first, so the first of a kind is the newest of it.
  const newest = major ? releases[0] : releases.find((one) => majorOf(one.version) === now);
  const next =
    newest !== undefined && compareVersions(newest.version, release.version) > 0
      ? newest
      : undefined;
  if (major) return { next };
  const later = releases.find((one) => compareVersions(majorOf(one.version), now) > 0);
  return { next, ready: later?.version };
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

/** Do the renames in order, each into a directory made for it if it is not there. */
async function applyMoves(moves: readonly Move[]): Promise<void> {
  for (const move of moves) {
    await mkdir(dirname(move.to), { recursive: true });
    await rename(move.from, move.to);
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
