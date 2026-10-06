/**
 * A `PATH` for one test: the real tools it names, and nothing else, so that a
 * command finds no real program a test did not ask for.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, symlink } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

/**
 * A directory for `PATH` that holds these real tools and nothing else: a
 * machine with no systemd, where the tools a test needs still work.
 */
async function binWith(t: TestContext, tools: readonly string[]): Promise<string> {
  const bin = join(await makeHome(t), 'bin');
  await mkdir(bin);
  for (const tool of tools) {
    const found = (process.env['PATH'] ?? '')
      .split(delimiter)
      .map((directory) => join(directory, tool))
      .find(isExecutable);
    if (found !== undefined) await symlink(found, join(bin, tool));
  }
  return bin;
}

/**
 * A `PATH` that holds these real tools and nothing else a test did not ask
 * for. Windows will not link a file without a privilege, and finds a tool by
 * its extension, so there it names the directory each tool is in.
 */
export async function pathWith(t: TestContext, tools: readonly string[]): Promise<string> {
  if (process.platform !== 'win32') return binWith(t, tools);
  const extensions = (process.env['PATHEXT'] ?? '.EXE;.CMD').split(';');
  const directories = tools.flatMap((tool) => {
    const found = (process.env['PATH'] ?? '')
      .split(delimiter)
      .find((directory) =>
        extensions.some((extension) => isFile(join(directory, tool + extension))),
      );
    return found === undefined ? [] : [found];
  });
  return [await binWith(t, []), ...directories].join(delimiter);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
