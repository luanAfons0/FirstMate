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
import { TOKEN_PARAMETER } from './security.ts';

/** The command Windows reaches a distribution through. */
const WSL = 'wsl.exe';

/** How long one wsl.exe call may take before the program gives up on it. */
const WSL_TIMEOUT_MS = 10_000;

/** Where a distribution's filesystem appears to Windows. */
const DISTRIBUTION_PREFIX = '\\\\wsl.localhost\\';

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
  const token = encodeURIComponent(runtime.token);
  return `http://127.0.0.1:${runtime.port}/?${TOKEN_PARAMETER}=${token}`;
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
function ask(args: readonly string[]): Promise<Answer> {
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
        timeout: WSL_TIMEOUT_MS,
        // No console window flashes, because this is a desktop program.
        windowsHide: true,
      },
      (fault, stdout, stderr) => {
        if (fault !== null) {
          const said = plain(stderr).trim();
          done({ kind: 'silent', why: said === '' ? fault.message : said });
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
