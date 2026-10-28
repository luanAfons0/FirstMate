/**
 * Updating a Plugin installed from a Plugin Release: take the newest Plugin
 * Release in the same MAJOR, and put its Release Files where the old ones
 * were (ADR-0033).
 *
 * The steps run in this order, each one a function of its own:
 *
 * 1. `clearPrevious` removes what the clean-up of an update that ended left,
 *    and refuses what an update that did not end left.
 * 2. `nextRelease` asks GitHub for the Plugin Releases, and picks the one to take.
 * 3. `stageRelease` (`fetch-plugin.ts`, as install does) downloads, checks and
 *    unpacks it into `.<name>.pending` in the Shelf, and in a `wsl` Place gives
 *    its executable files their bit back there.
 * 4. `checkReleaseFiles` and `checkNothingInTheWay` refuse, before any change,
 *    an old Release File that changed or is gone, and the Plugin's data where a
 *    new Release File or directory goes.
 * 5. `planSteps` writes down, as data, every step the update is made of: each
 *    old Release File, and the old record, into `.<name>.previous`, then the
 *    directories, then each new Release File into place, then the new record
 *    last.
 * 6. `applyOrRollBack` does the steps in that order, and when one fails it
 *    undoes those done, newest first.
 * 7. `removeEmptied` removes the directories a dropped Release File left
 *    empty. The update is done by then, so what it cannot remove is a warning.
 *
 * Every file the old record does not name is the Plugin's data, and no step
 * touches it. Writing the Registry row, restarting the Plugin Server and
 * removing `.<name>.pending` and `.<name>.previous` are the caller's: the row
 * is the Registry's, only a terminal reaches the Host, and on Windows a
 * running `mcp.exe` moved into `.<name>.previous` can be removed only once
 * the Host has stopped it.
 *
 * The steps are a list so that a roll-back reads the same list the update
 * did: it undoes the steps done so far backwards. The checks read the two
 * records, as a Release File that is gone has no step.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, type Stats } from 'node:fs';
import { mkdir, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, posix, relative } from 'node:path';
import { stageRelease, type Staging } from './fetch-plugin.ts';
import type { HeldPlugin } from './plugin-places.ts';
import {
  compareVersions,
  pluginReleases,
  type ArchiveTarget,
  type PluginRelease,
} from './plugin-release.ts';
import { refuse } from './refusal.ts';
import {
  parentOf,
  readReleaseRecord,
  releaseFilesOf,
  type ReleaseRecord,
  type Unpacked,
} from './release-files.ts';
import { folded, RELEASE_RECORD } from './tar.ts';

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
  /** What the update could not tidy once it was done, each a sentence that says what to do. */
  readonly warnings: readonly string[];
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

/**
 * Move this Plugin to the newest Plugin Release in its MAJOR, and say from
 * which Release Version to which, or move nothing when it is on the newest
 * already. Nothing is downloaded then, and nothing changes. With `major` it
 * takes the newest Plugin Release of all. Without it, a newer MAJOR is never
 * taken, and the Release Version of the newest one is given back as `ready`.
 * `target` picks the archive, as it does for install, and a `wsl` Place
 * takes the one for its distribution's own arch.
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
  await clearPrevious(plugin, previous);

  const { next, ready } = await nextRelease(release, major);
  if (next === undefined) return { ready };
  const old = await readReleaseRecord(plugin.files);
  const unpacked = await stageRelease(next, stagingOf(plugin, pending), target);
  try {
    checkReleaseFiles(plugin.files, old, release.version);
    const emptied = checkNothingInTheWay(plugin.files, old, unpacked, next.version);
    const steps = planSteps(old, unpacked, emptied, { plugin: plugin.files, pending, previous });
    await applyOrRollBack(steps, previous, plugin.name, release.version);
  } catch (fault) {
    await rm(pending, { recursive: true, force: true });
    throw fault;
  }
  // The update is done once the new record is in place, so what is left is
  // tidying, and a fault in it is a warning that says what to do, never a
  // failure that would hide an update that took place.
  return {
    moved: {
      from: release.version,
      to: next.version,
      release: { repository: next.repository, version: next.version },
      leftBehind: [pending, previous],
      warnings: await removeEmptied(plugin.files, old, unpacked),
    },
    ready,
  };
}

/**
 * Where an update stages its Plugin Release: `.<name>.pending` in the Shelf,
 * and in a `wsl` Place the same directory as the distribution names it.
 */
function stagingOf(plugin: HeldPlugin, pending: string): Staging {
  if (plugin.runner.kind !== 'wsl') return { path: pending };
  const inside = posix.join(posix.dirname(plugin.directory), basename(pending));
  return { path: pending, wsl: { distribution: plugin.runner.distribution, path: inside } };
}

/**
 * Deal with a `.<name>.previous` that an update left. When the Plugin's
 * directory and `.<name>.previous` both hold a record, the update ended, as
 * the new record moves in last, and the old one goes out before it: only its
 * clean-up did not, so the old Release Files are removed now. Else the update
 * did not end, and `.<name>.previous` may hold the only copy of old Release
 * Files, which only the operator can put back.
 */
async function clearPrevious(plugin: HeldPlugin, previous: string): Promise<void> {
  if (lstatSync(previous, { throwIfNoEntry: false }) === undefined) return;
  const ended = [previous, plugin.files].every(
    (directory) =>
      lstatSync(join(directory, RELEASE_RECORD), { throwIfNoEntry: false }) !== undefined,
  );
  if (!ended) {
    throw refuse(
      'invalid',
      `${previous} is left from an update of ${plugin.name} that did not end: ` +
        'put back what it holds, or take it away, then run update again.',
    );
  }
  try {
    await rm(previous, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (fault) {
    throw refuse(
      'invalid',
      `${previous} holds the old Release Files of an update of ${plugin.name} that ended, and ` +
        `it could not be removed (${messageOf(fault)}): remove it once ${plugin.name} is ` +
        'stopped, then run update again.',
      { cause: fault },
    );
  }
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
 * One step of an update, as data: a rename from one path to another, both
 * whole; a directory to make, if it is not there; or an emptied directory to
 * remove, so a new Release File can take its path.
 */
type Step =
  | { readonly from: string; readonly to: string }
  | { readonly make: string }
  | { readonly unmake: string };

/**
 * Every step the update is made of, in order: each old Release File that is
 * there, and the old record, into `previous`; each directory that held only
 * old Release Files and is in the way of a new one, deepest first; each
 * directory the new Plugin Release names, empty ones too; each new Release
 * File into the Plugin's directory; and the new record last, so a Plugin's
 * record changes only once every Release File it names is in place.
 */
function planSteps(
  old: ReleaseRecord,
  now: Unpacked,
  emptied: readonly string[],
  where: { readonly plugin: string; readonly pending: string; readonly previous: string },
): Step[] {
  const out = [...releaseFilesOf(old), RELEASE_RECORD]
    .filter((path) => lstatSync(join(where.plugin, path), { throwIfNoEntry: false }) !== undefined)
    .map((path) => ({ from: join(where.plugin, path), to: join(where.previous, path) }));
  const unmake = emptied.map((path) => ({ unmake: join(where.plugin, path) }));
  const make = now.directories.map((path) => ({ make: join(where.plugin, path) }));
  const into = [...releaseFilesOf(now.record), RELEASE_RECORD].map((path) => ({
    from: join(where.pending, path),
    to: join(where.plugin, path),
  }));
  return [...out, ...unmake, ...make, ...into];
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
  // Windows writes a link's target with `\` between its parts, and the
  // record holds it as the archive did, with `/`.
  for (const [path, target] of Object.entries(old.links ?? {})) {
    kept(
      path,
      (found) =>
        found.isSymbolicLink() && readlinkSync(join(plugin, path)).replaceAll('\\', '/') === target,
    );
  }
}

/** A file's SHA-256, as the record of Release Files writes it. */
function hashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Refuse, before any change, the Plugin's data where the new Plugin Release
 * puts a Release File or a directory: at its path, or at a directory above
 * it, as a file or a symbolic link. A path an old Release File holds is free,
 * as that file moves out first, and so is a directory that holds nothing but
 * old Release Files. Those directories are given back, deepest first, to be
 * removed once the old Release Files are out, so the new file can take the
 * path.
 */
function checkNothingInTheWay(
  plugin: string,
  old: ReleaseRecord,
  now: Unpacked,
  version: string,
): string[] {
  const leaving = new Set(releaseFilesOf(old));
  const emptied: string[] = [];
  const wanted: [string, 'file' | 'directory'][] = [
    ...releaseFilesOf(now.record).map((path): [string, 'file'] => [path, 'file']),
    ...now.directories.map((path): [string, 'directory'] => [path, 'directory']),
  ];
  for (const [path, kind] of wanted) {
    const parts = path.split('/');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const at = parts.slice(0, depth).join('/');
      const found = lstatSync(join(plugin, at), { throwIfNoEntry: false });
      // What an old Release File holds is free once it moves out, and so is
      // all below it.
      if (found === undefined || isLeaving(plugin, at, found, leaving)) break;
      if (found.isDirectory()) {
        if (depth < parts.length || kind === 'directory') continue;
        const inside = onlyLeaving(plugin, at, leaving);
        if (inside !== undefined) {
          emptied.push(...inside);
          break;
        }
      }
      throw refuse(
        'invalid',
        `${join(plugin, at)} is the Plugin's data, and Plugin Release ${version} ships ` +
          `${path} there: move it out of the Plugin's directory, then run update again.`,
      );
    }
  }
  return emptied;
}

/**
 * Whether what is at this path is an old Release File: by its path, or, on a
 * system that does not tell names apart by case, the same file by another
 * case of its name. The same file is asked of the file system, so a file of
 * data that differs only in case, where the system does tell them apart, is
 * never taken for one.
 */
function isLeaving(
  plugin: string,
  at: string,
  found: Stats,
  leaving: ReadonlySet<string>,
): boolean {
  if (leaving.has(at)) return true;
  const key = at.split('/').map(folded).join('/');
  for (const path of leaving) {
    if (path.split('/').map(folded).join('/') !== key) continue;
    const same = lstatSync(join(plugin, path), { throwIfNoEntry: false });
    if (same !== undefined && same.ino === found.ino && same.dev === found.dev) return true;
  }
  return false;
}

/**
 * The directory at this path and every directory below it, deepest first,
 * when it holds nothing but old Release Files, or nothing when it holds
 * anything else, which is the Plugin's data.
 */
function onlyLeaving(
  plugin: string,
  at: string,
  leaving: ReadonlySet<string>,
): string[] | undefined {
  const directories = [at];
  for (const entry of readdirSync(join(plugin, at), { recursive: true, withFileTypes: true })) {
    const path = relative(plugin, join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    if (entry.isDirectory()) directories.push(path);
    else if (!leaving.has(path)) return undefined;
  }
  return directories.sort((a, b) => b.split('/').length - a.split('/').length);
}

/**
 * Do the steps, and when one fails, undo the ones done, newest first, so the
 * old Release Files are back where they were, the new ones are back in
 * `.<name>.pending`, and the old record still names them. Directories the
 * steps made go too, then `.<name>.previous`, which holds nothing then. When
 * the undo fails as well, `.<name>.previous` is kept, as it holds the only
 * copy of what it could not put back.
 */
async function applyOrRollBack(
  steps: readonly Step[],
  previous: string,
  name: string,
  version: string,
): Promise<void> {
  const undo: (() => Promise<void>)[] = [];
  try {
    for (const step of steps) undo.push(await apply(step));
  } catch (fault) {
    const failed = said(steps[undo.length]);
    try {
      for (const one of undo.reverse()) await one();
      await rm(previous, { recursive: true, force: true });
    } catch (back) {
      throw new Error(
        `${failed} failed, and so did putting the old Release Files of ${name} back ` +
          `(${messageOf(back)}): ${previous} holds the ones still missing, so move them back ` +
          "into the Plugin's directory.",
        { cause: fault },
      );
    }
    throw new Error(
      `${failed} failed (${messageOf(fault)}), so update put the old Release Files of ${name} ` +
        `back, and ${name} is still on ${version}: fix what stopped the move, then run update again.`,
      { cause: fault },
    );
  }
}

/**
 * Do one step, and give back what undoes it. A rename goes into a directory
 * made for it if it is not there, and its undo removes that directory again.
 */
async function apply(step: Step): Promise<() => Promise<void>> {
  if ('unmake' in step) {
    await rmdir(step.unmake);
    return async () => {
      await mkdir(step.unmake);
    };
  }
  const made = await mkdir('make' in step ? step.make : dirname(step.to), { recursive: true });
  const unmade = async (): Promise<void> => {
    if (made !== undefined) await rm(made, { recursive: true });
  };
  if ('make' in step) return unmade;
  await rename(step.from, step.to);
  return async () => {
    await rename(step.to, step.from);
    await unmade();
  };
}

/** A step, as the sentence of its failure names it. */
function said(step: Step | undefined): string {
  if (step === undefined) return 'a step of the update';
  if ('unmake' in step) return `removing the emptied directory ${step.unmake}`;
  if ('make' in step) return `making the directory ${step.make}`;
  return `moving ${step.from} to ${step.to}`;
}

/** What a fault says, without the stack. */
function messageOf(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}

/**
 * Remove each directory an old Release File was in that is empty now and
 * that the new Plugin Release does not name, deepest first. A directory that
 * holds the Plugin's data is not empty, so it stays. The update is done by
 * now, so a directory that cannot be removed is a warning, not a failure.
 */
async function removeEmptied(plugin: string, old: ReleaseRecord, now: Unpacked): Promise<string[]> {
  const kept = new Set(now.directories);
  const emptied = new Set<string>();
  for (const path of releaseFilesOf(old)) {
    for (let up = parentOf(path); up !== '' && !kept.has(up); up = parentOf(up)) emptied.add(up);
  }
  const deepestFirst = [...emptied].sort((a, b) => b.split('/').length - a.split('/').length);
  const warnings: string[] = [];
  for (const directory of deepestFirst) {
    await rmdir(join(plugin, directory)).catch((fault: NodeJS.ErrnoException) => {
      if (fault.code === 'ENOTEMPTY' || fault.code === 'EEXIST' || fault.code === 'ENOENT') return;
      warnings.push(
        `${join(plugin, directory)} held only old Release Files, and it could not be removed ` +
          `(${fault.message}): remove it if it is empty.`,
      );
    });
  }
  return warnings;
}
