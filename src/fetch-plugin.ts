/**
 * Fetching a Plugin: put its files in the Shelf, and say where they landed.
 *
 * It runs nothing the Plugin ships. A directory is copied, and that is the
 * whole of it; the Plugin's own executable runs later, when the Host starts
 * it. Fetching a Plugin and running a Plugin stay two separate decisions
 * (ADR-0012).
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
import { existsSync } from 'node:fs';
import { cp, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/**
 * Put the Plugin at this source into the Shelf under this Plugin Name, and
 * give back the directory it landed in. A fetch that fails leaves nothing
 * behind, so a caller can write a Registry row knowing the files are there.
 */
export async function fetchPlugin(
  source: string,
  shelf: string,
  name: string,
): Promise<string> {
  const target = join(shelf, name);
  if (existsSync(target)) {
    throw new Error(`${target} already exists. Take it away, or give the Plugin another name.`);
  }
  // Copying a directory into something it holds never ends.
  if (isInside(shelf, source)) {
    throw new Error(`The Shelf is inside ${source}, so a Plugin cannot be copied from there.`);
  }

  const staging = join(shelf, `.${name}.pending`);
  await rm(staging, { recursive: true, force: true });
  try {
    // Symlinks are copied as the Plugin wrote them, and nothing is followed
    // out of the Plugin's own directory.
    await cp(source, staging, { recursive: true, verbatimSymlinks: true });
    await rename(staging, target);
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    throw cause;
  }
  return target;
}

/** Whether the inner path is the outer one, or sits under it. */
function isInside(inner: string, outer: string): boolean {
  const down = relative(outer, inner);
  return down === '' || (!down.startsWith('..') && !isAbsolute(down));
}
