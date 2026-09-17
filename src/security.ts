/**
 * The security check applied to every request.
 *
 * The Host defends a loopback HTTP API itself, because a Plugin Page reaches
 * its tools over same-origin HTTP rather than through postMessage (ADR-0003).
 * DNS rebinding against local services is exploited in the wild, so the checks
 * here are the ones that advisory after advisory has asked for.
 *
 * The token arrives as a query parameter on the first navigation. The Host
 * then sets a host-only SameSite=Strict cookie and redirects to the same
 * address without the parameter, so that the relative asset paths inside a
 * Plugin Page are never disturbed.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The cookie the Host admits a browser with. It is host-only and per run. */
export const COOKIE_NAME = 'firstmate_token';

/** The query parameter the token arrives on, once. */
export const TOKEN_PARAMETER = 'token';

export type Doorstep = {
  /** The port the Host listened on, which names it in a Host header. */
  readonly port: number;
  /** The token minted at startup. */
  readonly token: string;
};

export type Admission =
  /** The request is mine. Answer it. */
  | { readonly kind: 'serve' }
  /** The request carries the token on a navigation. Set the cookie, then send
   *  the browser to the same address without the parameter. */
  | { readonly kind: 'admit'; readonly cookie: string; readonly location: string }
  /** The request is not mine. */
  | { readonly kind: 'refuse'; readonly reason: string };

export function checkRequest(
  request: IncomingMessage,
  url: URL,
  doorstep: Doorstep,
): Admission {
  const hostHeader = request.headers.host;
  if (hostHeader === undefined || !hostNames(doorstep.port).has(hostHeader)) {
    return refuse(`the Host header ${hostHeader ?? 'is missing'}`);
  }

  const origin = request.headers.origin;
  if (origin !== undefined && !origins(doorstep.port).has(origin)) {
    // The literal `null` is what a sandboxed frame and a file:// page send.
    return refuse(`the Origin ${origin}`);
  }

  const site = header(request, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && !isOwnNavigation(request, site)) {
    return refuse(`a Sec-Fetch-Site of ${site}`);
  }

  if (holdsToken(request.headers.cookie, doorstep.token)) {
    return { kind: 'serve' };
  }

  const given = url.searchParams.get(TOKEN_PARAMETER);
  if (given !== null && same(given, doorstep.token)) {
    // A browser that navigated here gets the cookie and a clean address. A
    // terminal did not navigate, so it gets the answer it asked for.
    if (header(request, 'sec-fetch-mode') === 'navigate') {
      return { kind: 'admit', cookie: cookieFor(doorstep.token), location: withoutToken(url) };
    }
    return { kind: 'serve' };
  }

  return refuse('no token');
}

/**
 * A request the person made themselves, by typing the address or by opening it
 * from the Tray, carries `Sec-Fetch-Site: none`: no site started it. That is
 * the one value other than `same-origin` this Host accepts, and only for a
 * top-level document, because it is how every first navigation arrives. A
 * navigation from another site says `cross-site` and is refused with the rest.
 */
function isOwnNavigation(request: IncomingMessage, site: string): boolean {
  return (
    site === 'none' &&
    header(request, 'sec-fetch-mode') === 'navigate' &&
    header(request, 'sec-fetch-dest') === 'document'
  );
}

function hostNames(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

function origins(port: number): ReadonlySet<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

function cookieFor(token: string): string {
  // No Domain attribute, so the cookie is host-only. No Max-Age, so it dies
  // with the browser session, as the token dies with the run.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

function withoutToken(url: URL): string {
  const clean = new URL(url);
  clean.searchParams.delete(TOKEN_PARAMETER);
  return `${clean.pathname}${clean.search}`;
}

function holdsToken(cookies: string | undefined, token: string): boolean {
  if (cookies === undefined) return false;
  for (const pair of cookies.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== COOKIE_NAME) continue;
    if (same(pair.slice(equals + 1).trim(), token)) return true;
  }
  return false;
}

function same(given: string, token: string): boolean {
  const offered = Buffer.from(given, 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function refuse(reason: string): Admission {
  return { kind: 'refuse', reason };
}
