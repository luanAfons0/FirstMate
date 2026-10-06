/**
 * The Host's addresses, as the App reaches them, and whose each one is.
 *
 * The App's Host runs in its own main process, but the App still reaches it
 * the way a browser and a terminal do: over loopback, admitted by the token.
 * That keeps one door into the Host, the one `security.ts` guards.
 *
 * Every address on the Host belongs to one owner: a Plugin, for everything
 * under `/p/<name>/`, or the Index Page, for the rest. The window gives each
 * owner a view of its own, and this is what tells it which.
 */
import { TOKEN_PARAMETER } from '@firstmate/core/runtime';

/** A Host that runs: where it listens, and the token that admits the App. */
export type HostAt = {
  /** The port the Host listens on. */
  readonly port: number;
  /** The token. It is put on an address and never said. */
  readonly token: string;
};

/** The owner of the Index Page and of every address that is not a Plugin's. */
export const INDEX = '';

/** The Host's origin. */
function originOf(host: HostAt): string {
  return `http://127.0.0.1:${host.port}`;
}

/** One address on the Host, with no token, for a view that holds the cookie. */
export function onHost(host: HostAt, path: string): string {
  return new URL(path, originOf(host)).href;
}

/**
 * One address on the Host, with the token on it once. The Host trades it for
 * the cookie and sends the view on without it, exactly as it does a browser.
 */
export function admitted(host: HostAt, path: string): string {
  const url = new URL(path, originOf(host));
  url.searchParams.set(TOKEN_PARAMETER, host.token);
  return url.href;
}

/** The path of one Plugin's page. */
export function pluginPath(name: string): string {
  return `/p/${encodeURIComponent(name)}/`;
}

/**
 * Whose an address on the Host is: a Plugin Name, or `INDEX`. Undefined when
 * the address is not on the Host at all. Only the path is read.
 */
export function ownerOf(host: HostAt, address: string): string | undefined {
  const url = URL.parse(address, originOf(host));
  if (url === null || url.origin !== originOf(host)) return undefined;
  const found = /^\/p\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if (found?.[1] === undefined) return INDEX;
  try {
    return decodeURIComponent(found[1]);
  } catch {
    return found[1];
  }
}

/** Whether a path is its owner's own first page, which shows what is open. */
export function isOwnStart(owner: string, path: string): boolean {
  return path === (owner === INDEX ? '/' : pluginPath(owner));
}

/** The path, query and fragment of an address on the Host. */
export function pathOf(address: string): string {
  const url = URL.parse(address);
  return url === null ? '/' : `${url.pathname}${url.search}${url.hash}`;
}

/** The kinds of address the system browser is given. Nothing else leaves the
 *  App, so a page cannot make Windows run a file or a protocol handler. */
const OUTSIDE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/**
 * Whether an address belongs in the system browser and not in the App: the
 * web, which the operator's own browser holds, signed in and with its tabs.
 * The blank page and anything that cannot be read are not the web.
 */
export function leavesTheHost(host: HostAt, address: string): boolean {
  const url = URL.parse(address);
  if (url === null || !OUTSIDE_PROTOCOLS.has(url.protocol)) return false;
  return url.origin !== originOf(host);
}

/**
 * What the system browser is given when the strip asks to open what the
 * window shows: that address, admitted. Anything not on the Host gives the
 * Index Page. The address is the one the view reports, and nothing is read
 * out of the page to find it (ADR-0008).
 */
export function browserAddress(host: HostAt, shown: string | undefined): string {
  const url = shown === undefined ? null : URL.parse(shown);
  if (url === null || url.origin !== originOf(host)) return admitted(host, '/');
  return admitted(host, `${url.pathname}${url.search}${url.hash}`);
}
