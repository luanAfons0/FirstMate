/**
 * `firstmate desktop`: install the App of this command line's own version,
 * and open it.
 *
 * One tag releases the command line and the App with one version, so the App
 * this installs is the one that speaks this command line's protocol
 * (ADR-0023). It downloads the installer when it is asked to, never when the
 * package is installed, from the GitHub Release of its own version. An
 * installer whose SHA-256 is not the one published beside it is refused
 * before it is written anywhere, so nothing runs. The installer is the
 * one-click, per-user NSIS installer, so `/S` installs it silently, with no
 * administrator.
 *
 * Whether the App is installed, and which version, is read where the
 * installer records it for Windows itself: the App's uninstall key in HKCU,
 * named by the GUID `electron-builder.yml` pins. Its `DisplayVersion` is the
 * version, and `InstallLocation` in the install key beside it is the folder.
 * Windows' own list of apps reads the same key, so it stays right for as long
 * as the App can be uninstalled. The folder is not guessed: its name comes
 * from the package name, and its parent can be moved by the operator.
 * `reg.exe export` reads both keys, because it writes UTF-16, while
 * `reg.exe query` writes the console's code page and garbles any name that
 * is not ASCII.
 *
 * An App newer than this command line is opened and not replaced. The App
 * updates itself, so it is often ahead of a command line installed months
 * ago, and an install would take it back.
 *
 * From WSL, Windows is reached through interop: `cmd.exe` names the Windows
 * temp folder, `wslpath` turns a Windows path into one here, and the
 * installer, `reg.exe` and the App run as the Windows programs they are. On
 * Windows the same code runs with every path as it is. Anywhere else there is
 * no Windows to install the App on.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AT_LOGON, LOGON_NAME, RUN_KEY } from '@firstmate/core/logon';
import { refuse } from '@firstmate/core/refusal';
import { ownVersion } from './version.ts';

/** The variable that points `firstmate desktop` at another place for the Releases. */
const RELEASES_VARIABLE = 'FIRSTMATE_RELEASES_URL';

/** Where the files of each GitHub Release are downloaded from, one folder per tag. */
const RELEASES_URL = 'https://github.com/luanAfons0/FirstMate/releases/download';

/**
 * The GUID `electron-builder.yml` pins for the App. The installer names the
 * App's registry keys by it, and nothing else names them.
 */
const APP_GUID = '97530065-71e0-5fdb-bf30-b8a47e68e176';

/** The key Windows lists the App by, with its version. */
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_GUID}`;

/** The key the installer keeps the App's folder in. */
const INSTALL_KEY = `HKCU\\Software\\${APP_GUID}`;

/** The App's program, in its folder: the product name. */
const APP_PROGRAM = 'FirstMate.exe';

/** A folder as Windows names it, and as this process reaches it. */
type Folder = { readonly windows: string; readonly here: string };

/** How this process reaches Windows. */
type Windows = {
  /** Windows' temp folder: the installer is saved there, and the registry read through it. */
  readonly temp: Folder;
  /** A Windows path, as this process reaches it. */
  readonly here: (path: string) => Promise<string>;
};

/** The App as it is installed: its version, and its program as this process and Windows reach it. */
type Installed = {
  readonly version: string;
  readonly program: string;
  readonly windowsProgram: string;
};

/**
 * The App on this machine, as `setup` and the commands that need it see it:
 * how Windows is reached, and the App, or nothing when it is not installed.
 */
export type AppHere = { readonly windows: Windows; readonly installed: Installed | undefined };

/**
 * The App on this machine, or nothing when there is no Windows here to hold
 * one: on Linux outside WSL, on macOS, or where interop is not on the PATH.
 */
export async function appHere(env: NodeJS.ProcessEnv = process.env): Promise<AppHere | undefined> {
  try {
    const windows = await reachWindows(env);
    return { windows, installed: await installedApp(windows) };
  } catch {
    // reg.exe or interop not on the PATH: there is no Windows here to ask.
    return undefined;
  }
}

/** Whether the App starts at logon: whether its entry is in the Run key. */
export async function logonIsOn(here: AppHere): Promise<boolean> {
  return (await readKey(here.windows, RUN_KEY))?.has(LOGON_NAME) === true;
}

/**
 * Have the App start at logon, by the same entry the App writes from its
 * Tray, so that each sees what the other set.
 */
export async function turnLogonOn(installed: Installed): Promise<void> {
  const command = `"${installed.windowsProgram}" ${AT_LOGON}`;
  await ask('reg.exe', ['add', RUN_KEY, '/v', LOGON_NAME, '/t', 'REG_SZ', '/d', command, '/f']);
}

/**
 * Install the App of this version unless it is there already, then open it.
 * It gives back the exit code, and throws a refusal with its kind.
 */
export async function installApp(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const windows = await reachWindows(env);
  const version = ownVersion();

  const installed = await installedApp(windows);
  if (installed !== undefined && compareVersions(installed.version, version) >= 0) {
    await open(installed.program);
    console.log(
      installed.version === version
        ? `firstmate: opened FirstMate ${version}.`
        : `firstmate: opened FirstMate ${installed.version}, which is newer than this command line, ${version}.`,
    );
    return 0;
  }

  const name = `FirstMate-Setup-${version}.exe`;
  const url = `${(env[RELEASES_VARIABLE] || RELEASES_URL).replace(/\/+$/, '')}/v${version}/${name}`;
  const expected = await publishedChecksum(`${url}.sha256`, version);
  console.log(`firstmate: downloading FirstMate ${version} from ${url}`);
  const bytes = await download(url, version);
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw refuse(
      'invalid',
      `the installer from ${url} does not match its published SHA-256, so it was not run.`,
    );
  }

  const installer = join(windows.temp.here, name);
  await writeFile(installer, bytes, { mode: 0o755 });
  try {
    await runInstaller(installer, version);
  } finally {
    await removeTemp(installer);
  }

  const now = await installedApp(windows);
  if (now === undefined || now.version !== version) {
    throw new Error(`the installer ran, but Windows has no record of FirstMate ${version}.`);
  }
  await open(now.program);
  console.log(`firstmate: installed FirstMate ${version}, and opened it.`);
  return 0;
}

/** Windows, as this process reaches it, or a sentence saying there is none. */
async function reachWindows(env: NodeJS.ProcessEnv): Promise<Windows> {
  if (process.platform === 'win32') {
    const temp = tmpdir();
    return { temp: { windows: temp, here: temp }, here: async (path) => path };
  }
  if (process.platform !== 'linux' || (env['WSL_DISTRO_NAME'] ?? '') === '') {
    throw new Error(
      'the FirstMate App runs on Windows. Run firstmate desktop on Windows, or inside WSL.',
    );
  }
  const here = async (path: string): Promise<string> =>
    (await ask('wslpath', ['-u', path])).toString('utf8').trim();
  // /u has cmd.exe write UTF-16, so a user name that is not ASCII survives.
  const temp = (await ask('cmd.exe', ['/d', '/u', '/c', 'echo', '%TEMP%']))
    .toString('utf16le')
    .trim();
  return { temp: { windows: temp, here: await here(temp) }, here };
}

/**
 * Remove a file this command put in the temp folder. Windows can hold a file
 * a moment after the program that used it ends, while Defender scans an
 * installer, so the removal tries again for a few seconds. A file it still
 * cannot remove is left in the temp folder: it was only ever a copy, and
 * failing a command that did its work over it would be wrong.
 */
async function removeTemp(path: string): Promise<void> {
  // Node tries again only when told the removal is recursive, which for one
  // file changes nothing else.
  await rm(path, { force: true, recursive: true, maxRetries: 10, retryDelay: 300 }).catch(
    () => undefined,
  );
}

/** The App as the registry records it, or nothing when it is not installed. */
async function installedApp(windows: Windows): Promise<Installed | undefined> {
  const version = (await readKey(windows, UNINSTALL_KEY))?.get('DisplayVersion');
  const folder = (await readKey(windows, INSTALL_KEY))?.get('InstallLocation');
  if (version === undefined || folder === undefined) return undefined;
  const windowsProgram = `${folder}\\${APP_PROGRAM}`;
  const program = await windows.here(windowsProgram);
  // A folder deleted by hand leaves its keys behind, and installing again mends both.
  return isFile(program) ? { version, program, windowsProgram } : undefined;
}

/**
 * Every value of one registry key, or nothing when there is no such key. The
 * key is exported to a file in the temp folder, read, and removed.
 */
async function readKey(
  windows: Windows,
  key: string,
): Promise<ReadonlyMap<string, string> | undefined> {
  const name = `firstmate-${process.pid}.reg`;
  const answer = await run('reg.exe', ['export', key, `${windows.temp.windows}\\${name}`, '/y']);
  if (answer.code !== 0) return undefined;
  const file = join(windows.temp.here, name);
  let text: string;
  try {
    text = (await readFile(file)).toString('utf16le');
  } finally {
    await removeTemp(file);
  }
  const values = new Map<string, string>();
  for (const [, field = '', value = ''] of text.matchAll(/^"([^"]+)"="((?:[^"\\]|\\.)*)"\r?$/gm)) {
    values.set(field, value.replace(/\\(.)/g, '$1'));
  }
  return values;
}

/** The SHA-256 published beside the installer, in lower-case hex. */
async function publishedChecksum(url: string, version: string): Promise<string> {
  const text = (await download(url, version)).toString('utf8');
  const hash = /^([0-9a-f]{64})(?:\s|$)/i.exec(text.trim())?.[1];
  if (hash === undefined) throw refuse('invalid', `${url} does not hold a SHA-256 checksum.`);
  return hash.toLowerCase();
}

/** One file of the Release, whole. A Release that does not hold it is a refusal. */
async function download(url: string, version: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (fault) {
    const cause = fault instanceof Error && fault.cause instanceof Error ? fault.cause : fault;
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${url} could not be downloaded: ${why}.`, { cause: fault });
  }
  if (response.status === 404) {
    throw refuse('missing', `there is no FirstMate ${version} to install: ${url} is not there.`);
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** Run the installer silently, for this user alone, and wait for it to finish. */
async function runInstaller(installer: string, version: string): Promise<void> {
  const child = spawn(installer, ['/S'], { stdio: 'ignore' });
  const code = await new Promise<number | null>((done, fail) => {
    child.once('error', (cause) =>
      fail(new Error(`the installer could not be run: ${cause.message}.`, { cause })),
    );
    child.once('exit', done);
  });
  if (code !== 0) {
    throw new Error(`the installer exited ${code}, and FirstMate ${version} may not be installed.`);
  }
}

/** Start the App on its own, and leave it running when this command ends. */
async function open(program: string): Promise<void> {
  const child = spawn(program, [], { detached: true, stdio: 'ignore' });
  await new Promise<void>((done, fail) => {
    child.once('spawn', done);
    child.once('error', (cause) =>
      fail(new Error(`the App at ${program} could not be opened: ${cause.message}.`, { cause })),
    );
  });
  child.unref();
}

/** What one run of a Windows tool said, and how it ended. */
type Answer = { readonly code: number | null; readonly stdout: Buffer; readonly stderr: Buffer };

/** Run a tool and wait for its answer. A tool that is not there is a sentence. */
function run(program: string, argv: readonly string[]): Promise<Answer> {
  return new Promise((done, fail) => {
    const child = spawn(program, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', (cause: NodeJS.ErrnoException) =>
      fail(
        cause.code === 'ENOENT'
          ? new Error(`${program} is not on the PATH, and firstmate desktop reaches Windows by it.`)
          : new Error(`${program} could not be run: ${cause.message}.`, { cause }),
      ),
    );
    child.once('close', (code) =>
      done({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }),
    );
  });
}

/** Run a tool that must succeed, and give back what it wrote. */
async function ask(program: string, argv: readonly string[]): Promise<Buffer> {
  const answer = await run(program, argv);
  if (answer.code !== 0) {
    const said = answer.stderr.toString('utf8').trim().split(/\r?\n/)[0] ?? '';
    throw new Error(
      `${program} ${argv.join(' ')} exited ${answer.code}${said ? `: ${said}` : ''}.`,
    );
  }
  return answer.stdout;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Two versions in semver's order: below zero when `a` is older than `b`. */
function compareVersions(a: string, b: string): number {
  const [left, right] = [versionParts(a), versionParts(b)];
  for (let at = 0; at < 3; at += 1) {
    const step = (left.core[at] ?? 0) - (right.core[at] ?? 0);
    if (step !== 0) return step;
  }
  // A version with no prerelease part comes after every prerelease of it.
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length;
  }
  for (let at = 0; at < Math.max(left.pre.length, right.pre.length); at += 1) {
    const [x, y] = [left.pre[at], right.pre[at]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** A version's three numbers and its prerelease words, with any build part left off. */
function versionParts(version: string): {
  readonly core: readonly number[];
  readonly pre: readonly string[];
} {
  const plain = version.split('+')[0] ?? '';
  const dash = plain.indexOf('-');
  const core = dash < 0 ? plain : plain.slice(0, dash);
  return {
    core: core.split('.').map((part) => Number(part) || 0),
    pre: dash < 0 ? [] : plain.slice(dash + 1).split('.'),
  };
}
