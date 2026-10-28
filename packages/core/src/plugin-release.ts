/**
 * Find a Plugin's Plugin Releases on GitHub, and download the archive of one,
 * checked against its `.sha256` (ADR-0033).
 *
 * A Plugin Release is a GitHub Release at a tag `vMAJOR.MINOR.PATCH` that is
 * neither a draft nor a prerelease, and its Release Version is the tag
 * without the `v`. Only a git URL on GitHub can have one; any other URL is
 * cloned, as before. The download is the App's own (`release-download.ts`),
 * so a Plugin Release and the App are trusted by the same rule.
 *
 * FIRSTMATE_GITHUB_API_URL moves where the releases are asked for, and
 * FIRSTMATE_GITHUB_URL where their files are downloaded from, as
 * FIRSTMATE_RELEASES_URL moves the App's download. Tests point both at a
 * server of their own. FirstMate holds no token, so a private repository is
 * one GitHub does not show, and it is cloned with the operator's own login.
 */
import { refuse } from './refusal.ts';
import { fetchChecked } from './release-download.ts';

/** Where the releases of a repository are asked for, unless moved. */
const GITHUB_API = 'https://api.github.com';

/** Where the files of a release are downloaded from, unless moved. */
const GITHUB = 'https://github.com';

/** A GitHub URL, in the form a browser shows and in the form ssh clones. */
const GITHUB_URL = [
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
];

/** The tag of a Plugin Release, with its Release Version's three numbers. */
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** One Plugin Release, as GitHub lists it. */
export type PluginRelease = {
  /** The repository it is in, `owner/repo`. */
  readonly repository: string;
  /** Its Release Version, `MAJOR.MINOR.PATCH`. */
  readonly version: string;
  /** The names of the files it holds. */
  readonly assets: readonly string[];
};

/** The GitHub repository a git URL names, as `owner/repo`, or nothing for any other URL. */
export function githubRepository(url: string): string | undefined {
  for (const form of GITHUB_URL) {
    const [, owner, repo] = form.exec(url) ?? [];
    if (owner !== undefined && repo !== undefined) return `${owner}/${repo}`;
  }
  return undefined;
}

/**
 * The Plugin Releases of a repository, newest first, or nothing when GitHub
 * does not know the repository. A repository GitHub knows with no Plugin
 * Release gives an empty list. GitHub lists the newest hundred Releases on
 * one page, and that is enough to find the newest Plugin Release.
 */
export async function pluginReleases(repository: string): Promise<PluginRelease[] | undefined> {
  const api = process.env['FIRSTMATE_GITHUB_API_URL'] || GITHUB_API;
  const url = `${api}/repos/${repository}/releases?per_page=100`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'firstmate',
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch (fault) {
    const cause = fault instanceof Error && fault.cause instanceof Error ? fault.cause : fault;
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`GitHub could not be asked for the releases of ${repository}: ${why}.`, {
      cause: fault,
    });
  }
  if (response.status === 404) return undefined;
  const wait = rateLimitWait(response);
  if (wait !== undefined) {
    // Cloning would hide that GitHub is saying no, and a clone of a Plugin
    // that has a Plugin Release is not the one its author published.
    throw refuse(
      'invalid',
      `GitHub is limiting how often releases are asked for, so ${repository} was not ` +
        `fetched. Try again ${wait}.`,
    );
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for the releases of ${repository}.`);
  }
  const listed = (await response.json()) as unknown;
  if (!Array.isArray(listed)) {
    throw new Error(`GitHub did not answer a list of the releases of ${repository}.`);
  }
  const releases: PluginRelease[] = [];
  for (const release of listed as GitHubRelease[]) {
    if (release === null || release.draft === true || release.prerelease === true) continue;
    const version = TAG.exec(String(release.tag_name))?.[0].slice(1);
    if (version === undefined) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    releases.push({
      repository,
      version,
      assets: assets.map((asset) => String(asset?.name)),
    });
  }
  return releases.sort((one, other) => compareVersions(other.version, one.version));
}

/**
 * When to try again, as a phrase, if GitHub answered with its rate limit, or
 * nothing for any other answer. GitHub says it with 429, or with 403 and no
 * requests left, and tells the time in `retry-after` (seconds) or in
 * `x-ratelimit-reset` (a Unix time in seconds).
 */
function rateLimitWait(response: Response): string | undefined {
  const limited =
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
  if (!limited) return undefined;
  const after = Number(response.headers.get('retry-after'));
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const seconds =
    response.headers.get('retry-after') !== null && Number.isFinite(after)
      ? after
      : response.headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset)
        ? reset - Date.now() / 1000
        : undefined;
  if (seconds === undefined) return 'in a few minutes';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** A Release as the GitHub API lists it, as far as a Plugin Release needs it. */
type GitHubRelease = {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
  readonly assets?: readonly { readonly name?: unknown }[];
} | null;

/** Which of two Release Versions is newer: above zero when the first is. */
function compareVersions(one: string, other: string): number {
  const a = one.split('.').map(Number);
  const b = other.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const step = (a[index] ?? 0) - (b[index] ?? 0);
    if (step !== 0) return step;
  }
  return 0;
}

/**
 * The names an archive of this Plugin Release may have, in the order they are
 * taken. Its name part is the repository's name, which the release workflow
 * names it by.
 */
function archiveNames(release: PluginRelease): string[] {
  const name = release.repository.split('/')[1] ?? '';
  return [`${name}-${release.version}.tar.gz`];
}

/**
 * The archive of this Plugin Release, whole, gzipped, and checked against the
 * `.sha256` beside it. Anything else is a thrown sentence, and nothing was
 * written anywhere.
 */
export async function downloadPluginRelease(release: PluginRelease): Promise<Buffer> {
  const { repository, version } = release;
  const archive = archiveNames(release).find((name) => release.assets.includes(name));
  if (archive === undefined) {
    throw refuse(
      'invalid',
      `the Plugin Release ${version} of ${repository} holds no archive named ` +
        `${archiveNames(release).join(' or ')}. Ask the Plugin's author to publish one.`,
    );
  }
  const downloads = process.env['FIRSTMATE_GITHUB_URL'] || GITHUB;
  return fetchChecked({
    url: `${downloads}/${repository}/releases/download/v${version}/${archive}`,
    what: 'Plugin Release',
    missing: (url) => `the Plugin Release ${version} of ${repository} holds no ${url}.`,
    doing: `downloading ${archive}`,
    downloaded: () => `downloaded ${archive}`,
  });
}
