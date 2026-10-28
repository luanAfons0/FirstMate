/**
 * A fake GitHub, for the tests of a Plugin Release: the releases API and the
 * downloads, on one local server.
 *
 * FIRSTMATE_GITHUB_API_URL and FIRSTMATE_GITHUB_URL point the command line at
 * it instead of GitHub, so no test reaches the network. It knows only the
 * repositories a test publishes to, answers 404 for every other path, and
 * keeps every path it was asked for, in order.
 *
 * A test makes its Plugin Releases with `pluginRelease`, which runs the same
 * archive script the release workflow runs, so what the workflow makes is what
 * `install` is tested to read. A test that needs a Plugin Release the script
 * would never make changes the assets it gives back: a `.sha256` left out, or
 * bytes of its own. A test that needs an answer GitHub gives on a bad day, such
 * as its rate limit, sets that answer for one path with `answer`.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { makeHome } from './host.ts';

const REPOSITORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The archive script the release workflow runs. */
const ARCHIVE_SCRIPT = join(REPOSITORY, 'scripts', 'plugin-release-archive.ts');

/** One GitHub Release, as the fake holds it: its tag, how it is marked, and its files. */
export type FakeRelease = {
  /** The tag, such as `v1.2.0`. A Plugin Release's tag is `vMAJOR.MINOR.PATCH`. */
  readonly tag: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  /** Each file of the Release, by its name. */
  readonly assets: Readonly<Record<string, Buffer>>;
};

/** One fixed answer, for a path a test wants answered its own way. */
type Answer = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

/** The fake GitHub, as the command line and the test reach it. */
export type FakeGitHub = {
  /** The environment that points the command line at this fake. */
  readonly env: Readonly<Record<string, string>>;
  /** Every path the server was asked for, in order. */
  readonly asked: readonly string[];
  /**
   * Publish a Release in a repository, `owner/repo`, as its author's workflow
   * does. A repository with nothing published is not there, and the API
   * answers 404 for it; one published with no Release lists none.
   */
  publish(repository: string, release?: FakeRelease): void;
  /** Answer this path, exactly, with this answer from now on. */
  answer(path: string, answer: Answer): void;
};

/** Start a fake GitHub that knows no repository, and stop it when the test ends. */
export async function serveGitHub(t: TestContext): Promise<FakeGitHub> {
  const repositories = new Map<string, FakeRelease[]>();
  const answers = new Map<string, Answer>();
  const asked: string[] = [];
  let origin = '';

  const server = createServer((request, response) => {
    const path = request.url ?? '';
    asked.push(path);
    const fixed = answers.get(path);
    if (fixed !== undefined) {
      response.writeHead(fixed.status, fixed.headers).end(fixed.body);
      return;
    }
    const api = /^\/repos\/([^/]+\/[^/]+)\/releases(?:\?.*)?$/.exec(path);
    const releases = api?.[1] === undefined ? undefined : repositories.get(api[1]);
    if (api !== null && releases !== undefined) {
      const listed = releases.map((release, index) => ({
        id: index + 1,
        tag_name: release.tag,
        draft: release.draft ?? false,
        prerelease: release.prerelease ?? false,
        assets: Object.entries(release.assets).map(([name, bytes]) => ({
          name,
          size: bytes.length,
          browser_download_url: `${origin}/${api[1]}/releases/download/${release.tag}/${name}`,
        })),
      }));
      // GitHub lists the newest Release first.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(listed.reverse()));
      return;
    }
    const download = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
    const [, repository = '', tag, name = ''] = download ?? [];
    const release = repositories.get(repository)?.find((each) => each.tag === tag);
    const bytes = release?.assets[name];
    response.writeHead(bytes === undefined ? 404 : 200).end(bytes);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    env: { FIRSTMATE_GITHUB_API_URL: origin, FIRSTMATE_GITHUB_URL: origin },
    asked,
    publish(repository, release) {
      const releases = repositories.get(repository) ?? [];
      if (release !== undefined) releases.push(release);
      repositories.set(repository, releases);
    },
    answer(path, answer) {
      answers.set(path, answer);
    },
  };
}

/**
 * A Plugin Release of this folder, made by the archive script: the archive
 * `<name>-<version>.tar.gz`, or `<name>-<version>-<platform>.tar.gz` when a
 * platform such as `linux-x64` is given, and its `.sha256`. Two of these at
 * the same version are one Release with more archives: spread their assets
 * into one.
 */
export async function pluginRelease(
  t: TestContext,
  folder: string,
  name: string,
  version: string,
  platform?: string,
): Promise<FakeRelease> {
  const out = await makeHome(t);
  const argv = [ARCHIVE_SCRIPT, folder, name, version, out, ...(platform ? [platform] : [])];
  const archive = await new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    let failed = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (said += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (failed += chunk));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0
        ? done(said.trim())
        : fail(new Error(`The archive script exited ${code}: ${failed}`)),
    );
  });
  const file = basename(archive);
  return {
    tag: `v${version}`,
    assets: {
      [file]: await readFile(archive),
      [`${file}.sha256`]: await readFile(`${archive}.sha256`),
    },
  };
}
