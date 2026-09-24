/**
 * What the desktop program knows about the Host, and how it finds it out.
 *
 * The Host is a Linux process and the desktop program is a Windows one, so the
 * two meet at one file: the Host writes its port and its token into its home
 * directory, and Windows reads that file over the `\\wsl.localhost\` path
 * (ADR-0007). Everything said afterwards goes over loopback, which WSL already
 * forwards, so nothing new carries traffic between the two halves.
 *
 * This is the part that decides. It imports nothing native and owns no window
 * (ADR-0011), because both bugs ever filed against the PowerShell Tray lived in
 * logic of this kind, and logic of this kind is worth reading on its own.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { HOME_VARIABLE } from './config.ts';
import { RUNTIME_FILE, type Runtime } from './runtime.ts';
import type { PluginState } from './supervisor.ts';
import { TOKEN_PARAMETER } from './security.ts';
import { readKeys, type KeyChord } from './shortcut.ts';

/** The command Windows reaches a distribution through. */
const WSL = 'wsl.exe';

/** How long one wsl.exe call may take before the program gives up on it. */
const WSL_TIMEOUT_MS = 10_000;

/**
 * How long the service manager has to start the Host, or start it again.
 *
 * Longer than a call that only asks a question: a restart stops every Plugin
 * Server and starts it again, and systemd is entitled to take a moment over it.
 */
const RESTART_TIMEOUT_MS = 20_000;

/** Where a distribution's filesystem appears to Windows. */
const DISTRIBUTION_PREFIX = '\\\\wsl.localhost\\';

/**
 * How often the Host is asked whether it is up.
 *
 * Asking its port costs nothing, so the icon can be honest every few seconds.
 */
export const POLL_MS = 5_000;

/**
 * How seldom the runtime file is read when the Host will not answer.
 *
 * Reading it crosses into the distribution, and a Host that is simply down must
 * not become a running cost.
 */
export const REREAD_MS = 30_000;

/** How long the Host has to answer one poll. */
const POLL_TIMEOUT_MS = 2_000;

/**
 * The Host's own rule for where it keeps its state, asked of the distribution
 * in the distribution's own shell: FIRSTMATE_HOME, or ~/.firstmate. Asking is
 * what keeps the window free of an address to type.
 */
const HOME_SCRIPT = `printf %s "\${${HOME_VARIABLE}:-$HOME/.firstmate}"`;

/** What the program says where it cannot draw at all. */
export const NO_DESKTOP =
  'The FirstMate window needs a desktop to draw on, and this machine has none. ' +
  'It belongs on Windows, beside the notification area. The Host stays where it ' +
  'is, and the two meet over 127.0.0.1.';

export type Where = {
  /** The WSL distribution the Host runs in, for example Debian. */
  readonly distribution: string;
  /** The Host's home directory, as the distribution sees it. */
  readonly home: string;
};

export type Found =
  /** The Host is running, and this is the run to talk to. */
  | { readonly kind: 'found'; readonly where: Where; readonly runtime: Runtime }
  /** It is not, and this is the sentence to say about it. */
  | { readonly kind: 'lost'; readonly reason: string };

/**
 * Whether there is anywhere to draw a window.
 *
 * WSL Debian carries no tray host, no notification daemon and no panel, and the
 * service that runs the Host sets no display at all, so a window asked for from
 * there would have nowhere to appear.
 */
export function hasDesktop(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform === 'win32' || platform === 'darwin') return true;
  return read(env, 'DISPLAY') !== undefined || read(env, 'WAYLAND_DISPLAY') !== undefined;
}

/**
 * The Windows path of the Host's runtime file.
 * `/home/luanh/.firstmate` in Debian becomes
 * `\\wsl.localhost\Debian\home\luanh\.firstmate\runtime.json`.
 */
export function runtimePathIn(where: Where): string {
  const inside = where.home.replaceAll('/', '\\').replace(/\\+$/, '');
  return `${DISTRIBUTION_PREFIX}${where.distribution}${inside}\\${RUNTIME_FILE}`;
}

/**
 * The address of the Index Page, with the token on it once.
 *
 * The Host answers this with a cookie and sends the view to the same address
 * without the parameter, exactly as it does a browser, so this is the only
 * place the token is ever written and it is never written to a file.
 */
export function indexAddress(runtime: Runtime): string {
  return address(runtime, '/');
}

/** The address of one Plugin Page, carrying the token exactly as the Index
 *  Page's does. It is how the window returns to where it was after a restart. */
export function pluginAddress(runtime: Runtime, name: string): string {
  return address(runtime, `/p/${encodeURIComponent(name)}/`);
}

/** The address the Plugin list is asked for, carrying the token as the rest do. */
function pluginsAddress(runtime: Runtime): string {
  return address(runtime, '/plugins.json');
}

function address(runtime: Runtime, path: string): string {
  const token = encodeURIComponent(runtime.token);
  return `http://127.0.0.1:${runtime.port}${path}?${TOKEN_PARAMETER}=${token}`;
}

/**
 * What the Host said when it was asked. Three answers, never two.
 *
 * A port that answers does not prove the token in hand still opens it: the Host
 * keeps the same port and mints a new token at every start, so a run can end and
 * be replaced without the port ever stopping answering. Asking the Host itself
 * is the only honest check.
 */
export type HostSays =
  /** It answered, and this token opens it. */
  | 'running'
  /** It answered and refused the token: the run was replaced. */
  | 'stale'
  /** Nothing answered at all. */
  | 'absent';

/** What the Host says about one Plugin. */
export type PluginSeen = {
  /** The Plugin Name, which is also its address. */
  readonly name: string;
  /** Whether it ships a Plugin Page, so whether there is anything to open. */
  readonly hasPage: boolean;
  /** What the Host knows about its Plugin Server right now. */
  readonly state: PluginState;
};

/**
 * What the Host said about the Plugins.
 *
 * "The Host would not say" and "the Registry is empty" are different states
 * with different menus, and this is why they are written as two shapes rather
 * than as a list that may be empty. Conflating them took the Tray down: the
 * empty guard passed, the loop then ran once over nothing, and the throw inside
 * a menu handler ended the whole application (#44). Here there is no value that
 * can mean both.
 */
export type Plugins =
  /** The Host answered. The list may be empty, and an empty list means empty. */
  | { readonly kind: 'told'; readonly plugins: readonly PluginSeen[] }
  /** The Host would not say. Nothing is known, and nothing is claimed. */
  | { readonly kind: 'untold' };

/** One Shortcut, as the Tray holds it: the keys Windows is asked for, and
 *  the address a press opens. */
export type ShortcutSeen = {
  /** What `RegisterHotKey` needs, read from the keys by the one parser. */
  readonly chord: KeyChord;
  /** The path on the Host it opens, such as `/p/daily/new.html`. */
  readonly address: string;
};

/**
 * What the Host said about the Shortcuts. As with the Plugins, "would not
 * say" is its own shape: a Host that is down has not unbound anything, so the
 * keys stay held and a press can say the Host is down.
 */
export type Shortcuts =
  | { readonly kind: 'told'; readonly shortcuts: readonly ShortcutSeen[] }
  | { readonly kind: 'untold' };

/** What the program knows about the Host at one moment. */
export type Pulse = {
  /** What the icon shows and the tooltip says. */
  readonly state: 'running' | 'stopped';
  /** The run to talk to, when there is one. */
  readonly runtime: Runtime | undefined;
  /** Every Plugin the Host reports, or the fact that it would not report. */
  readonly plugins: Plugins;
  /** Every Shortcut the Host reports, or the fact that it would not report. */
  readonly shortcuts: Shortcuts;
};

/**
 * Every Plugin the Host knows, or the fact that it would not say.
 *
 * The Host serves the Index Page for a person and this for the program, which
 * cannot read a page. It is one loopback GET, the same trip the poll already
 * makes: no wsl.exe call and no file read.
 */
export async function askForPlugins(runtime: Runtime): Promise<Plugins> {
  let said: unknown;
  try {
    const answer = await fetch(pluginsAddress(runtime), {
      redirect: 'manual',
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (!answer.ok) return { kind: 'untold' };
    said = await answer.json();
  } catch {
    return { kind: 'untold' };
  }

  if (typeof said !== 'object' || said === null) return { kind: 'untold' };
  const { plugins } = said as { readonly plugins?: unknown };
  // An answer without the name is an answer from something that is not the
  // Host. It is not an empty Registry.
  if (!Array.isArray(plugins)) return { kind: 'untold' };
  return { kind: 'told', plugins: plugins.flatMap(onePlugin) };
}

/** One row of that answer, or none of it. A row FirstMate cannot read is left
 *  out rather than shown as a Plugin with no name. */
function onePlugin(row: unknown): readonly PluginSeen[] {
  if (typeof row !== 'object' || row === null) return [];
  const { name, hasPage, state } = row as {
    readonly name?: unknown;
    readonly hasPage?: unknown;
    readonly state?: unknown;
  };
  if (typeof name !== 'string' || name === '') return [];
  if (state !== 'running' && state !== 'stopped' && state !== 'no-plugin-server') return [];
  return [{ name, hasPage: hasPage === true, state }];
}

/**
 * Every Shortcut the Host knows, or the fact that it would not say.
 *
 * Asked on the same beat as the Plugins, so that a Shortcut bound from a
 * terminal is held within one beat, with no restart (ADR-0013).
 */
export async function askForShortcuts(runtime: Runtime): Promise<Shortcuts> {
  let said: unknown;
  try {
    const answer = await fetch(address(runtime, '/shortcuts.json'), {
      redirect: 'manual',
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (!answer.ok) return { kind: 'untold' };
    said = await answer.json();
  } catch {
    return { kind: 'untold' };
  }
  if (typeof said !== 'object' || said === null) return { kind: 'untold' };
  const { shortcuts } = said as { readonly shortcuts?: unknown };
  if (!Array.isArray(shortcuts)) return { kind: 'untold' };
  return { kind: 'told', shortcuts: shortcuts.flatMap(oneShortcut) };
}

/** One row of that answer, or none of it. Keys the parser will not read, or
 *  an address outside every Plugin, are never handed to Windows. */
function oneShortcut(row: unknown): readonly ShortcutSeen[] {
  if (typeof row !== 'object' || row === null) return [];
  const { keys, address: path } = row as { readonly keys?: unknown; readonly address?: unknown };
  if (typeof keys !== 'string' || typeof path !== 'string') return [];
  if (!path.startsWith('/p/')) return [];
  const read = readKeys(keys);
  if (read.kind === 'wrong' || read.chord.keys !== keys) return [];
  return [{ chord: read.chord, address: path }];
}

/** What to ask the helper for, to hold exactly the keys wanted. */
export type Reconciled = {
  /** Keys to ask Windows for. */
  readonly register: readonly KeyChord[];
  /** Keys to give back. */
  readonly release: readonly string[];
};

/**
 * What to register and what to release, so that the keys asked for become the
 * keys wanted.
 *
 * `asked` holds every key already asked for, held or refused alike. A refused
 * key is not asked for again on every beat, because each refusal would be one
 * more notification about the same key; it is asked for again once it has been
 * unbound and bound again, or when the Tray starts. A Host that would not say
 * changes nothing: the keys stay held, and a press says the Host is down.
 */
export function reconcile(asked: ReadonlySet<string>, wanted: Shortcuts): Reconciled {
  if (wanted.kind === 'untold') return { register: [], release: [] };
  const keys = new Set(wanted.shortcuts.map((shortcut) => shortcut.chord.keys));
  return {
    register: wanted.shortcuts
      .map((shortcut) => shortcut.chord)
      .filter((chord) => !asked.has(chord.keys)),
    release: [...asked].filter((held) => !keys.has(held)),
  };
}

/** The line that asks the helper to hold one key combination. */
export function registerCommand(chord: KeyChord): string {
  return `register ${chord.keys} ${chord.modifiers} ${chord.key}`;
}

/** The line that asks the helper to give one back. */
export function releaseCommand(keys: string): string {
  return `release ${keys}`;
}

/** One line the helper wrote, read. */
export type HotkeyEvent =
  | { readonly kind: 'ready' }
  | { readonly kind: 'registered'; readonly keys: string }
  | { readonly kind: 'released'; readonly keys: string }
  | { readonly kind: 'pressed'; readonly keys: string }
  | { readonly kind: 'refused'; readonly keys: string; readonly reason: string }
  | { readonly kind: 'unknown'; readonly line: string };

export function readHotkeyEvent(line: string): HotkeyEvent {
  const [word = '', keys = '', ...rest] = line.trim().split(' ');
  if (word === 'ready' && keys === '') return { kind: 'ready' };
  if (keys !== '' && rest.length === 0) {
    if (word === 'registered' || word === 'released' || word === 'pressed') {
      return { kind: word, keys };
    }
  }
  if (word === 'refused' && keys !== '') {
    return { kind: 'refused', keys, reason: rest.join(' ') || 'Windows gave no reason' };
  }
  return { kind: 'unknown', line };
}

/**
 * The address a Popup loads: the Shortcut's own, with the token on it once,
 * as the window's first navigation carries it. The Host trades it for the
 * cookie, exactly as it does for the window.
 */
export function popupAddress(runtime: Runtime, path: string): string {
  const url = new URL(path, `http://127.0.0.1:${runtime.port}`);
  url.searchParams.set(TOKEN_PARAMETER, runtime.token);
  return url.href;
}

/**
 * Ask the Host whether it is up and whether this token still opens it.
 *
 * WSL forwards 127.0.0.1 into the distribution, so this asks from Windows with
 * no wsl.exe call and no file read. A HEAD asks the question without carrying
 * the page back.
 */
export async function askTheHost(runtime: Runtime): Promise<HostSays> {
  let answer: Response;
  try {
    answer = await fetch(indexAddress(runtime), {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch {
    return 'absent';
  }
  // Whatever else it disliked about that one address, the Host is up and this
  // token reaches it.
  return answer.status === 403 ? 'stale' : 'running';
}

/**
 * Whether the runtime file is worth reading again now.
 *
 * A refused token means the run was replaced, so it is read at once rather than
 * at the next tick: the person is one click away from an address that would be
 * refused. A Host that does not answer at all is read again seldom, because
 * reading it crosses into the distribution.
 */
export function readAgain(says: HostSays, sinceRead: number): boolean {
  if (says === 'running') return false;
  if (says === 'stale') return true;
  return sinceRead >= REREAD_MS;
}

/**
 * Watch the Host, and say what is true of it at every beat.
 *
 * This is the whole of the deciding the program does over time, and it imports
 * nothing native (ADR-0011). It returns the way to stop watching.
 */
export function watchTheHost(
  where: Where,
  from: Runtime,
  tell: (pulse: Pulse) => void,
): () => void {
  let held: Runtime | undefined = from;
  let lastRead = Date.now();
  let beating = false;
  let watching = true;

  async function beat(): Promise<void> {
    // A beat that overran its interval is not joined by a second one.
    if (beating || !watching) return;
    beating = true;
    try {
      let says: HostSays = held === undefined ? 'absent' : await askTheHost(held);

      if (readAgain(says, Date.now() - lastRead)) {
        lastRead = Date.now();
        held = await readRunAgain(where);
        says = held === undefined ? 'absent' : await askTheHost(held);
      }

      if (!watching) return;
      if (says !== 'running' || held === undefined) {
        tell({
          state: 'stopped',
          runtime: undefined,
          plugins: { kind: 'untold' },
          shortcuts: { kind: 'untold' },
        });
        return;
      }
      const [plugins, shortcuts] = await Promise.all([
        askForPlugins(held),
        askForShortcuts(held),
      ]);
      if (!watching) return;
      tell({ state: 'running', runtime: held, plugins, shortcuts });
    } catch (fault: unknown) {
      // One beat may fail. The program may not. An unhandled throw inside a
      // handler is what took the Tray down, and it took the whole application
      // with it (#44), so a beat says what went wrong and the next one runs.
      complain(fault);
    } finally {
      beating = false;
    }
  }

  const timer = setInterval(() => void beat(), POLL_MS);
  return () => {
    watching = false;
    clearInterval(timer);
  };
}

/**
 * The run of the Host, read again.
 *
 * The distribution is asked whether it is running before the path into it is
 * touched, every single time, because reading such a path is enough to start a
 * stopped distribution. Looking at FirstMate must never wake WSL.
 */
async function readRunAgain(where: Where): Promise<Runtime | undefined> {
  const listed = await ask(['--list', '--running', '--quiet']);
  if (listed.kind === 'silent') return undefined;
  if (!names(listed.output).includes(where.distribution)) return undefined;

  const found = await readRuntimeIn(where);
  return found.kind === 'found' ? found.runtime : undefined;
}

/**
 * Ask the distribution's service manager to start the Host, or start it again.
 *
 * This is the one place the program may start something rather than only report
 * it, and waking a stopped distribution is the point here rather than an
 * accident: the person asked for it. One command covers both, because a restart
 * starts a unit that is not running.
 *
 * Returns nothing when it worked, and the real failure as a sentence when it
 * did not. Every argument is passed as an argument. The Tray built this command
 * by joining strings, the quoting became part of the service name, and the
 * failure came back as the single letter N (#45).
 */
export async function restartTheHost(where: Where): Promise<string | undefined> {
  const said = await ask(
    ['-d', where.distribution, '--', 'systemctl', '--user', 'restart', 'firstmate'],
    RESTART_TIMEOUT_MS,
  );
  return said.kind === 'silent' ? said.why : undefined;
}

/**
 * The Plugin Name an address names, or nothing when it names the Index Page or
 * anything else the Host serves.
 *
 * Only the path is read. The address carries the token on the first navigation
 * of a run, and nothing here keeps it, writes it down or says it out loud.
 */
export function pluginOpenAt(address: string): string | undefined {
  let path: string;
  try {
    path = new URL(address).pathname;
  } catch {
    return undefined;
  }
  const found = /^\/p\/([^/]+)(?:\/|$)/.exec(path);
  if (found?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(found[1]);
  } catch {
    return found[1];
  }
}

/**
 * The run of the Host to talk to, or the reason there is none.
 *
 * The distribution is asked whether it is running **before** any path into it
 * is touched, because reading anything under `\\wsl.localhost\` is itself
 * enough to start a stopped distribution. The program shows the state, it does
 * not create it.
 */
export async function findTheHost(asked: Partial<Where>): Promise<Found> {
  const listed = await ask(['--list', '--running', '--quiet']);
  if (listed.kind === 'silent') {
    return lost(`Windows would not say which distributions are running: ${listed.why}`);
  }
  const running = names(listed.output);

  const distribution = asked.distribution ?? running[0];
  if (distribution === undefined) {
    return lost(
      'No WSL distribution is running, so the Host cannot be reached. Start the ' +
        'distribution that holds it, and FirstMate will find the Host in it.',
    );
  }
  if (asked.distribution === undefined && running.length > 1) {
    return lost(
      `${running.length} distributions are running: ${running.join(', ')}. Say which ` +
        'one holds the Host: firstmate desktop --distribution <name>',
    );
  }
  if (!running.includes(distribution)) {
    return lost(
      `The ${distribution} distribution is not running, so the Host is not either. ` +
        'FirstMate does not start it, because looking at FirstMate should not wake WSL.',
    );
  }

  const home = asked.home ?? (await askWhereHomeIs(distribution));
  if (typeof home !== 'string') return home;

  return readRuntimeIn({ distribution, home });
}

/** Where the distribution itself says the Host keeps its home directory. */
async function askWhereHomeIs(distribution: string): Promise<string | Found> {
  const said = await ask(['-d', distribution, '--exec', '/bin/sh', '-lc', HOME_SCRIPT]);
  if (said.kind === 'silent') {
    return lost(
      `${distribution} would not say where the Host keeps its home directory: ${said.why}`,
    );
  }
  const home = said.output.trim();
  if (home === '') {
    return lost(
      `${distribution} said nothing when asked where the Host keeps its home ` +
        'directory. Say it instead: firstmate desktop --home <path>',
    );
  }
  return home;
}

/**
 * The port and the token the Host last wrote, or the reason there is no run to
 * read: the Host never started, or it stopped and took its runtime file away.
 *
 * Neither the path nor anything inside it is ever printed. It holds a token.
 */
async function readRuntimeIn(where: Where): Promise<Found> {
  let text: string;
  try {
    text = await readFile(runtimePathIn(where), 'utf8');
  } catch {
    return lost(
      `The Host is not running in ${where.distribution}: it has written no runtime ` +
        'file. Start it there with: systemctl --user start firstmate',
    );
  }

  const runtime = parse(text);
  if (runtime === undefined) {
    return lost(
      `The Host's runtime file in ${where.distribution} names neither a port nor a ` +
        'token. Restart the Host there with: systemctl --user restart firstmate',
    );
  }
  return { kind: 'found', where, runtime };
}

/** A runtime file read whole, or nothing. A half-written one is no run. */
function parse(text: string): Runtime | undefined {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof read !== 'object' || read === null) return undefined;
  const { port, token } = read as { readonly port?: unknown; readonly token?: unknown };
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) return undefined;
  if (typeof token !== 'string' || token === '') return undefined;
  return { port, token };
}

type Answer =
  /** wsl.exe ran and this is what it wrote. */
  | { readonly kind: 'said'; readonly output: string }
  /** It did not run, or it failed, and this is why. */
  | { readonly kind: 'silent'; readonly why: string };

/**
 * One wsl.exe call.
 *
 * Every argument is passed as an argument. A command line built by joining
 * strings is what made the Tray's restart impossible: the quoting became part
 * of the service name (#45).
 */
function ask(args: readonly string[], timeout = WSL_TIMEOUT_MS): Promise<Answer> {
  return new Promise((done) => {
    execFile(
      WSL,
      [...args],
      {
        // WSL_UTF8 asks wsl.exe for UTF-8 rather than the UTF-16 it writes by
        // default. A wsl.exe too old to know the variable still answers in
        // UTF-16, so the NULs are dropped as well, which reads an ASCII name
        // either way.
        env: { ...process.env, WSL_UTF8: '1' },
        timeout,
        // No console window flashes, because this is a desktop program.
        windowsHide: true,
      },
      (fault, stdout, stderr) => {
        if (fault !== null) {
          // What the command itself said comes first, because that is the
          // sentence a person can act on. The library's own message is the
          // last resort, not the first.
          const why = plain(stderr).trim() || plain(stdout).trim() || fault.message;
          done({ kind: 'silent', why });
          return;
        }
        done({ kind: 'said', output: plain(stdout) });
      },
    );
  });
}

/** Every distribution name wsl.exe listed, in the order it listed them. */
function names(output: string): readonly string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** What wsl.exe wrote, with the UTF-16 padding of an older one taken out. */
function plain(output: string): string {
  return output.replaceAll('\u0000', '').replaceAll('﻿', '');
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const given = env[name];
  return given === undefined || given === '' ? undefined : given;
}

function lost(reason: string): Found {
  return { kind: 'lost', reason };
}

/** What has already been complained about. A fault every five seconds is not
 *  five seconds of news. */
const complained = new Set<string>();

function complain(fault: unknown): void {
  const said = fault instanceof Error ? fault.message : String(fault);
  if (complained.has(said)) return;
  complained.add(said);
  console.error(`firstmate: a look at the Host went wrong, and the next one will try again: ${said}`);
}
