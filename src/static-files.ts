/**
 * Serving a Plugin Page: the bytes in the Plugin's own web directory, and
 * nothing else.
 *
 * The Host returns those bytes unchanged. It does not rewrite, wrap, inject or
 * frame them, and a request never resolves outside the directory it names.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

/** The directory a Plugin puts its Plugin Page in. */
export const WEB_DIRECTORY = 'web';

/** The file served when a request names a directory. */
export const DIRECTORY_INDEX = 'index.html';

const CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function webRoot(directory: string): string {
  return join(directory, WEB_DIRECTORY);
}

export function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES.get(path.slice(dot).toLowerCase()) ?? 'application/octet-stream';
}

/**
 * The file a request path names inside a root, or null when it names anything
 * outside it. Percent-encoding is undone first, so an escape spelled `%2e%2e`
 * is caught with the one spelled `..`.
 */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export type StaticResult = 'sent' | 'outside' | 'missing' | 'redirect';

/**
 * Send one file from a root. A request that names a directory without a
 * trailing slash is redirected to one, so that the relative paths inside a
 * Plugin Page keep working.
 */
export async function serveStatic(
  response: ServerResponse,
  root: string,
  requestPath: string,
  redirectTo: (path: string) => string,
  headOnly: boolean,
): Promise<StaticResult> {
  const target = resolveInside(root, requestPath);
  if (target === null) return 'outside';

  let found = await describe(target);
  if (found === null) return 'missing';
  if (found.isDirectory) {
    if (!requestPath.endsWith('/')) {
      response.writeHead(308, { location: redirectTo(`${requestPath}/`) }).end();
      return 'redirect';
    }
    const index = join(target, DIRECTORY_INDEX);
    found = await describe(index);
    if (found === null || found.isDirectory) return 'missing';
    return send(response, index, found.size, headOnly);
  }
  return send(response, target, found.size, headOnly);
}

function send(
  response: ServerResponse,
  path: string,
  size: number,
  headOnly: boolean,
): StaticResult {
  response.writeHead(200, {
    'content-type': contentType(path),
    'content-length': String(size),
  });
  if (headOnly) {
    response.end();
    return 'sent';
  }
  createReadStream(path).pipe(response);
  return 'sent';
}

async function describe(path: string): Promise<{ isDirectory: boolean; size: number } | null> {
  try {
    const found = await stat(path);
    return { isDirectory: found.isDirectory(), size: found.size };
  } catch {
    return null;
  }
}
