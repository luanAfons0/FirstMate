/**
 * Fetching a Plugin: put its files in the Shelf, and say where they landed.
 *
 * It runs nothing the Plugin ships. A directory is copied and a git URL is
 * cloned, and that is the whole of it; the Plugin's own executable runs later,
 * when the Host starts it. Fetching a Plugin and running a Plugin stay two
 * separate decisions (ADR-0012).
 *
 * Cloning uses the `git` binary. That is one external tool the command line
 * assumes, it is not a package dependency, and the Host itself still has none.
 * If a second external binary is ever wanted, that is the moment to ask
 * whether fetching belongs in the Host at all, or in a Plugin.
 *
 * The files are staged inside the Shelf and renamed into place, and never
 * staged in the Host's home directory: a rename does not cross a filesystem,
 * and a Shelf on a code drive is as good as one in the home. A Shelf on a
 * Windows drive under WSL carries no POSIX modes and is case-insensitive, so
 * two Plugin Names differing only in case would collide there. That is worth
 * knowing, not worth refusing (ADR-0007).
 *
 * The copy is the asynchronous one on purpose. `cpSync` ends the whole process
 * on a source directory this user cannot read, rather than raising something
 * a caller can catch, and a command that dies like that leaves half a Plugin
 * in the Shelf and says nothing.
 */
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { cp, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/** A source git can clone: a URL with a scheme, or the scp-like short form. */
const GIT_URL = /^(?:https?|ssh|git|ftps?|file|git\+ssh|git\+https):\/\//;
const GIT_SHORT = /^[^/\\:]+@[^/\\:]+:/;

/** Whether this source is something to clone rather than something to copy. */
export function isGitUrl(source: string): boolean {
  return GIT_URL.test(source) || GIT_SHORT.test(source);
}

/**
 * Put the Plugin at this source into the Shelf under this Plugin Name, and
 * give back the directory it landed in. A fetch that fails leaves nothing
 * behind, so a caller can write a Registry row knowing the files are there.
 */
export async function fetchPlugin(source: string, shelf: string, name: string): Promise<string> {
  const target = join(shelf, name);
  // lstat, not exists: a symlink there that points nowhere is still in the way.
  if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
    throw new Error(`${target} already exists. Take it away, or give the Plugin another name.`);
  }

  const staging = join(shelf, `.${name}.pending`);
  await rm(staging, { recursive: true, force: true });
  try {
    if (isGitUrl(source)) await clone(source, staging);
    else await copyDirectory(source, staging, shelf);
    await rename(staging, target);
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    throw cause;
  }
  return target;
}

async function copyDirectory(source: string, staging: string, shelf: string): Promise<void> {
  // The source is taken to its real path first. A source that is itself a
  // symlink would otherwise be copied as a symlink, and the Shelf would hold
  // a pointer back to the original rather than a copy of it. The Shelf is a
  // real path already, so both sides of the check below are real.
  const real = await realpath(source);
  // Copying a directory into something it holds never ends.
  if (isInside(shelf, real)) {
    throw new Error(`The Shelf is inside ${source}, so a Plugin cannot be copied from there.`);
  }
  // Symlinks inside the Plugin are copied as the Plugin wrote them, and
  // nothing is followed out of the Plugin's own directory.
  await cp(real, staging, { recursive: true, verbatimSymlinks: true });
}

/**
 * Clone a Plugin into the staging directory.
 *
 * git writes to this process's own output, so whatever it says about a bad
 * URL or a missing network reaches the operator in git's own words, and a
 * clone that failed is never mistaken for a fault in FirstMate. Cloning runs
 * none of the Plugin's code; its executable runs when the Host starts it.
 */
function clone(url: string, staging: string): Promise<void> {
  return new Promise((done, fail) => {
    const git = spawn('git', ['clone', '--', url, staging], { stdio: 'inherit' });
    git.once('error', (cause: NodeJS.ErrnoException) => {
      fail(
        cause.code === 'ENOENT'
          ? new Error(
              'git is not on the PATH, and a URL needs it. Install git, or give a directory.',
            )
          : new Error(`git could not be run: ${cause.message}`, { cause }),
      );
    });
    git.once('exit', (code, signal) => {
      if (code === 0) {
        done();
        return;
      }
      const how = code === null ? `it was stopped by ${signal}` : `it exited ${code}`;
      fail(new Error(`git could not clone ${url}: ${how}.`));
    });
  });
}

/** Whether the inner path is the outer one, or sits under it. */
function isInside(inner: string, outer: string): boolean {
  const down = relative(outer, inner);
  return down === '' || (!down.startsWith('..') && !isAbsolute(down));
}
