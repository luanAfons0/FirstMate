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
 * On a terminal the download is a progress bar, and the SHA-256 check and the
 * install each say when they start and end. Piped, it prints the lines it
 * always has (ADR-0025).
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
 * Windows the same code runs with every path as it is.
 *
 * On Linux outside WSL the App is the AppImage, one file, put at
 * `~/Applications/FirstMate.AppImage`, where `setup` and the logon entry look
 * for it (ADR-0026). It is written beside itself and renamed into place, so a
 * running App keeps the file it started from. Its version is the one the
 * AppImage itself carries: its runtime extracts its desktop entry, which
 * names it as X-AppImage-Version, and runs nothing of the App. So an AppImage
 * that updated itself is read as the version it is now, and no file beside it
 * can go out of date. One whose version cannot be read was not packaged as
 * FirstMate, and this version replaces it. Anywhere else, on macOS, there is
 * no App to install.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AT_LOGON, LOGON_NAME, RUN_KEY } from '@firstmate/core/logon';
import { refuse } from '@firstmate/core/refusal';
import { startWait, whileWaiting } from './progress.ts';
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

/** Where `firstmate desktop` puts the App on Linux: one AppImage in `~/Applications`. */
export function appImagePath(): string {
  return join(homedir(), 'Applications', 'FirstMate.AppImage');
}

/** The files an AppImage's runtime is asked to extract: its desktop entry. */
const DESKTOP_ENTRY = '*.desktop';

/** How long an AppImage has to extract its desktop entry. */
const EXTRACT_TIMEOUT_MS = 10_000;

/** A folder as Windows names it, and as this process reaches it. */
type Folder = { readonly windows: string; readonly here: string };

/** How this process reaches Windows. */
type Windows = {
  /** Windows' temp folder: the installer is saved there, and the registry read through it. */
  readonly temp: Folder;
  /** A Windows path, as this process reaches it. */
  readonly here: (path: string) => Promise<string>;
};

/** The App as it is installed: its version, and its program here and as Windows names it. */
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
  if (isLinuxDesktop(env)) return installAppImage(env);
  const windows = await reachWindows(env);
  const version = ownVersion();

  const installed = await installedApp(windows);
  if (installed !== undefined && compareVersions(installed.version, version) >= 0) {
    await open(installed.program);
    console.log(openedSentence(installed.version, version));
    return 0;
  }

  const name = `FirstMate-Setup-${version}.exe`;
  const bytes = await fetchChecked(env, version, name, 'installer');
  const installer = join(windows.temp.here, name);
  await writeFile(installer, bytes, { mode: 0o755 });
  try {
    await whileWaiting(
      `installing FirstMate ${version}`,
      () => `installed FirstMate ${version}`,
      () => runInstaller(installer, version),
    );
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

/** Whether this is Linux outside WSL, where the App is the AppImage. */
function isLinuxDesktop(env: NodeJS.ProcessEnv): boolean {
  return process.platform === 'linux' && (env['WSL_DISTRO_NAME'] ?? '') === '';
}

/** What `desktop` says when the App was there already, of this version or a newer one. */
function openedSentence(installed: string, version: string): string {
  return installed === version
    ? `firstmate: opened FirstMate ${version}.`
    : `firstmate: opened FirstMate ${installed}, which is newer than this command line, ` +
        `${version}.`;
}

/** Install the AppImage of this version unless it is there already, then open it. */
async function installAppImage(env: NodeJS.ProcessEnv): Promise<number> {
  const version = ownVersion();
  const program = appImagePath();

  const installed = await appImageVersion(program);
  if (installed !== undefined && compareVersions(installed, version) >= 0) {
    await open(program);
    console.log(openedSentence(installed, version));
    return 0;
  }

  const bytes = await fetchChecked(env, version, `FirstMate-${version}.AppImage`, 'AppImage');
  await mkdir(dirname(program), { recursive: true });
  const part = `${program}.${process.pid}.part`;
  try {
    await writeFile(part, bytes, { mode: 0o755 });
    await rename(part, program);
  } finally {
    await rm(part, { force: true });
  }
  await open(program);
  console.log(`firstmate: installed FirstMate ${version} at ${program}, and opened it.`);
  return 0;
}

/**
 * The version the AppImage at this path carries, or nothing when there is no
 * AppImage there, or its version cannot be read. Its runtime extracts its
 * desktop entry into a folder of this command's own, which is then removed.
 */
async function appImageVersion(program: string): Promise<string | undefined> {
  if (!isFile(program)) return undefined;
  const scratch = await mkdtemp(join(tmpdir(), 'firstmate-appimage-'));
  try {
    const answer = await run(program, ['--appimage-extract', DESKTOP_ENTRY], {
      cwd: scratch,
      timeout: EXTRACT_TIMEOUT_MS,
    });
    if (answer.code !== 0) return undefined;
    const extracted = join(scratch, 'squashfs-root');
    const entry = (await readdir(extracted).catch(() => [])).find((name) =>
      name.endsWith('.desktop'),
    );
    if (entry === undefined) return undefined;
    const text = await readFile(join(extracted, entry), 'utf8');
    return /^X-AppImage-Version=(\S+)\s*$/m.exec(text)?.[1];
  } catch {
    // A program that cannot be run there is no AppImage this command knows.
    return undefined;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * One file of the Release of this version, downloaded whole and checked
 * against the SHA-256 published beside it. A file that does not match is
 * refused here, before it is written anywhere, so nothing runs.
 */
async function fetchChecked(
  env: NodeJS.ProcessEnv,
  version: string,
  name: string,
  what: string,
): Promise<Buffer> {
  const url = `${(env[RELEASES_VARIABLE] || RELEASES_URL).replace(/\/+$/, '')}/v${version}/${name}`;
  const expected = await publishedChecksum(`${url}.sha256`, version);
  console.log(`firstmate: downloading FirstMate ${version} from ${url}`);
  const bytes = await download(url, version, `downloading FirstMate ${version}`);
  const check = await startWait('checking the SHA-256');
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    check.failed();
    throw refuse(
      'invalid',
      `the ${what} from ${url} does not match its published SHA-256, so it was not run.`,
    );
  }
  check.done('the SHA-256 matches');
  return bytes;
}

/** Windows, as this process reaches it, or a sentence saying there is none. */
async function reachWindows(env: NodeJS.ProcessEnv): Promise<Windows> {
  if (process.platform === 'win32') {
    const temp = tmpdir();
    return { temp: { windows: temp, here: temp }, here: async (path) => path };
  }
  if (process.platform !== 'linux') {
    throw new Error('the FirstMate App runs on Windows and Linux. Run firstmate desktop on one.');
  }
  if (isLinuxDesktop(env)) {
    throw new Error('this Linux is not WSL, so there is no Windows to reach.');
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

/**
 * One file of the Release, whole. A Release that does not hold it is a
 * refusal. With something it is `doing`, the download is shown as it arrives:
 * a progress bar when the Release says its length, a spinner when it does not.
 */
async function download(url: string, version: string, doing?: string): Promise<Buffer> {
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
  if (doing === undefined || response.body === null) {
    return Buffer.from(await response.arrayBuffer());
  }

  const length = Number(response.headers.get('content-length'));
  const wait = await startWait(doing, Number.isSafeInteger(length) ? length : undefined);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of response.body) {
      chunks.push(chunk);
      wait.advance(chunk.byteLength);
    }
  } catch (fault) {
    wait.failed();
    throw fault;
  }
  const bytes = Buffer.concat(chunks);
  wait.done(`downloaded FirstMate ${version}, ${(bytes.length / 1_000_000).toFixed(1)} MB`);
  return bytes;
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

/**
 * Run a tool and wait for its answer, in `cwd` when given, and ended after
 * `timeout` milliseconds when given. A tool that is not there is a sentence.
 */
function run(
  program: string,
  argv: readonly string[],
  options: { readonly cwd?: string; readonly timeout?: number } = {},
): Promise<Answer> {
  return new Promise((done, fail) => {
    const child = spawn(program, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
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
