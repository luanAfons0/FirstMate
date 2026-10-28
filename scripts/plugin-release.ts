/**
 * Make the files of a Plugin Release from a tag of a Plugin's repository: the
 * work of the release workflow, `plugin-release.yml` (ADR-0033).
 *
 *   node scripts/plugin-release.ts <tag> <name> <out> [--test <command>] [--build <command>]
 *
 * Run it in the Plugin's repository. In order, it:
 *
 * 1. refuses a tag that is not `vMAJOR.MINOR.PATCH`, before anything runs;
 * 2. runs the `test` command, and stops when it fails;
 * 3. runs the `build` command, which writes `release/`;
 * 4. archives `release/`, or each `release/<platform>-<arch>/` folder as its
 *    own archive. With no build, it archives the tag with `git archive`,
 *    which leaves out every path `.gitattributes` marks `export-ignore`.
 *
 * Each archive, and its `.sha256`, is made by `plugin-release-archive.ts`,
 * the script the tests make their Plugin Releases with. This one only
 * chooses the folders, so there is one writer of archives. `<name>` is the
 * repository's name, which `install` looks for the archive by.
 *
 * The workflow is this script and an upload. Its one step runs this script,
 * so the tests run what the workflow runs, with no GitHub in the way. An
 * empty command is no command: a called workflow cannot leave an input out.
 */
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** A tag that names a Release Version: `v` and `MAJOR.MINOR.PATCH`, with no zero in front. */
const TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

/** The script that writes each archive and its `.sha256`. */
const ARCHIVE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'plugin-release-archive.ts');

/**
 * Node's names for a platform, as `process.platform` says them. A folder of
 * `release/` is a platform folder when its name is one of these, a hyphen and
 * an arch, so that a folder such as `web-assets` is never taken for one.
 */
const PLATFORMS = new Set([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
  'win32',
]);

/** Whether a name of `release/` names a platform and an arch, such as `linux-x64`. */
function isPlatformFolder(name: string): boolean {
  const [platform = '', arch, ...more] = name.split('-');
  return (
    PLATFORMS.has(platform) && arch !== undefined && /^[a-z0-9]+$/.test(arch) && more.length === 0
  );
}

/**
 * Run an author's command in the repository, its output passed through. It
 * runs in bash, as a `run:` step of GitHub Actions does, and in cmd.exe on
 * Windows, which has no bash of its own.
 */
function runCommand(which: string, command: string): void {
  const shell = process.platform === 'win32' ? true : 'bash';
  // The author's output is the log of the run, so it goes to stderr, and
  // stdout says only the paths of the archives.
  const ran = spawnSync(command, { shell, stdio: ['ignore', 2, 2] });
  if (ran.error !== undefined) {
    throw new Error(`The ${which} \`${command}\` could not start: ${ran.error.message}.`);
  }
  if (ran.status !== 0) {
    throw new Error(
      `The ${which} \`${command}\` failed, so there is no Plugin Release; fix it and push a new tag.`,
    );
  }
}

/** Run a program with no shell, and fail with what it said when it fails. */
function runProgram(program: string, argv: readonly string[]): string {
  const ran = spawnSync(program, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error !== undefined) throw ran.error;
  if (ran.status !== 0) {
    throw new Error(`${program} ${argv.join(' ')} failed: ${ran.stderr.trim()}`);
  }
  return ran.stdout;
}

/**
 * Every folder to archive under `release/`, each with its platform, or the
 * whole of `release/` with none. A mix of the two is refused: a file beside
 * the platform folders would ship in no archive, and nobody would know.
 */
async function releaseFolders(): Promise<{ folder: string; platform?: string }[]> {
  const found = await lstat('release').catch(() => null);
  if (found === null || !found.isDirectory()) {
    throw new Error('The build wrote no release/ folder; have it write the files to ship there.');
  }
  const names = (await readdir('release')).sort();
  const platforms: string[] = [];
  const others: string[] = [];
  for (const name of names) {
    const isFolder = (await lstat(join('release', name))).isDirectory();
    (isFolder && isPlatformFolder(name) ? platforms : others).push(name);
  }
  if (platforms.length === 0) return [{ folder: 'release' }];
  if (others.length > 0) {
    throw new Error(
      `release/ holds platform folders (${platforms.join(', ')}) and other files ` +
        `(${others.join(', ')}); put every file in a platform folder, or none.`,
    );
  }
  return platforms.map((platform) => ({ folder: join('release', platform), platform }));
}

/** Unpack the files of the tag, as `git archive` gives them, into this folder. */
function unpackTag(tag: string, folder: string): void {
  const tar = spawnSync('git', ['archive', '--format=tar', tag], { maxBuffer: 1 << 30 });
  if (tar.error !== undefined) throw tar.error;
  if (tar.status !== 0) {
    throw new Error(`git archive ${tag} failed: ${tar.stderr.toString().trim()}`);
  }
  // The system tar only unpacks here; the archive that ships is written by
  // the archive script. It runs in the folder, so a Windows path such as
  // C:\... is never read as a remote host by GNU tar.
  const unpacked = spawnSync('tar', ['-xf', '-'], { cwd: folder, input: tar.stdout });
  if (unpacked.error !== undefined) throw unpacked.error;
  if (unpacked.status !== 0) {
    throw new Error(`tar could not unpack the tag: ${unpacked.stderr.toString().trim()}`);
  }
}

/** Make the files of the Plugin Release, and give back the path of each archive. */
async function pluginRelease(argv: readonly string[]): Promise<string[]> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { test: { type: 'string', default: '' }, build: { type: 'string', default: '' } },
  });
  const [tag, name, out, ...more] = positionals;
  if (tag === undefined || name === undefined || out === undefined || more.length > 0) {
    throw new Error(
      'Give a tag, a name and an out folder: ' +
        'plugin-release.ts <tag> <name> <out> [--test <command>] [--build <command>]',
    );
  }
  const version = TAG.exec(tag)?.[1];
  if (version === undefined) {
    throw new Error(
      `The tag ${tag} is not vMAJOR.MINOR.PATCH, so it makes no Plugin Release; push a tag such as v1.2.0.`,
    );
  }

  if (values.test !== '') runCommand('test', values.test);
  if (values.build !== '') runCommand('build', values.build);
  const unpacked =
    values.build === '' ? await mkdtemp(join(tmpdir(), 'plugin-release-')) : undefined;
  try {
    let folders: { folder: string; platform?: string }[];
    if (unpacked === undefined) {
      folders = await releaseFolders();
    } else {
      unpackTag(tag, unpacked);
      folders = [{ folder: unpacked }];
    }
    return folders.map(({ folder, platform }) =>
      runProgram(process.execPath, [
        ARCHIVE_SCRIPT,
        folder,
        name,
        version,
        resolve(out),
        ...(platform === undefined ? [] : [platform]),
      ]).trim(),
    );
  } finally {
    if (unpacked !== undefined) await rm(unpacked, { recursive: true, force: true });
  }
}

try {
  for (const archive of await pluginRelease(process.argv.slice(2))) console.log(archive);
} catch (fault) {
  process.stderr.write(`${fault instanceof Error ? fault.message : String(fault)}\n`);
  process.exitCode = 1;
}
