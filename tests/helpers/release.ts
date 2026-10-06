/**
 * A fake GitHub Release, for the tests of `firstmate desktop`.
 *
 * FIRSTMATE_RELEASES_URL points the command line at this server instead of
 * GitHub. It holds the files a test gives it, under the paths a Release holds
 * them by, `/v<version>/<name>`, answers 404 for anything else, and keeps
 * every path it was asked for, in order.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';

/** What the fake Release holds for the command line's version. */
export type Release = 'good' | 'wrong checksum' | 'none';

/** The fake Release, as the command line and the test reach it. */
export type FakeRelease = {
  /** What FIRSTMATE_RELEASES_URL is set to. */
  readonly url: string;
  /** Every path the server was asked for, in order. */
  readonly asked: readonly string[];
};

/**
 * Serve one file of this version and its `.sha256` beside it, in the form
 * `sha256sum` writes, or nothing at all when the Release is `none`.
 */
export async function serveRelease(
  t: TestContext,
  release: Release,
  version: string,
  name: string,
  bytes: Buffer,
): Promise<FakeRelease> {
  const hash = createHash('sha256')
    .update(release === 'wrong checksum' ? 'some other file' : bytes)
    .digest('hex');
  const files: Readonly<Record<string, Buffer>> =
    release === 'none'
      ? {}
      : {
          [`/v${version}/${name}`]: bytes,
          [`/v${version}/${name}.sha256`]: Buffer.from(`${hash}  ${name}\n`),
        };

  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? '');
    const body = files[request.url ?? ''];
    response.writeHead(body === undefined ? 404 : 200).end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, asked };
}
