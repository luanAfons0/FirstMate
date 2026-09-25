/**
 * Serving a Plugin Page: the bytes in the Plugin's own web directory, and
 * nothing else.
 *
 * The Host returns those bytes unchanged. It does not rewrite, wrap, inject or
 * frame them, and a request never resolves outside the directory it names.
 */
import { open, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';

/** The directory a Plugin puts its Plugin Page in. */
const WEB_DIRECTORY = 'web';

/** The file served when a request names a directory. */
const DIRECTORY_INDEX = 'index.html';

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

/** The web directory of a Plugin, which may or may not exist. */
export function webRoot(directory: string): string {
  return join(directory, WEB_DIRECTORY);
}

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES.get(path.slice(dot).toLowerCase()) ?? 'application/octet-stream';
}

/**
 * The file a request path names inside a root, or null when it names anything
 * outside it. Percent-encoding is undone first, so an escape spelled `%2e%2e`
 * is caught with the one spelled `..`.
 */
function resolveInside(root: string, requestPath: string): string | null {
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

/** What became of one request for a file: sent, refused, missing, or redirected. */
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
    return send(response, index, headOnly);
  }
  return send(response, target, headOnly);
}

/**
 * The file is opened before a header is written, so that a file the Host may
 * not read, or one gone since it was found, is answered as missing rather than
 * as a 200 with no bytes behind it.
 */
async function send(
  response: ServerResponse,
  path: string,
  headOnly: boolean,
): Promise<StaticResult> {
  const file = await open(path, 'r').catch(() => null);
  if (file === null) return 'missing';
  // The length is the open file's own, so it cannot disagree with its bytes.
  const { size } = await file.stat();
  response.writeHead(200, {
    'content-type': contentType(path),
    'content-length': String(size),
  });
  if (headOnly) {
    await file.close();
    response.end();
    return 'sent';
  }
  // pipeline, not pipe: a browser that goes away mid-file must close the
  // file too, and a read that fails must end the response, not the Host.
  pipeline(file.createReadStream(), response, (fault) => {
    // A browser that leaves early is not news. A file that fails mid-read is.
    // Success passes undefined, not the null the types promise.
    if (fault !== null && fault !== undefined && fault.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(`FirstMate: ${path} could not be read to the end.`, fault);
    }
  });
  return 'sent';
}

async function describe(path: string): Promise<{ readonly isDirectory: boolean } | null> {
  try {
    const found = await stat(path);
    return { isDirectory: found.isDirectory() };
  } catch {
    return null;
  }
}
