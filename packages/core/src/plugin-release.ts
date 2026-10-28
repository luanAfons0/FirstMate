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
import { RELEASE_VERSION, REPOSITORY_PART, type PluginReleaseOf } from './registry.ts';
import { faultReason, fetchChecked } from './release-download.ts';

/** Where the releases of a repository are asked for, unless moved. */
const GITHUB_API = 'https://api.github.com';

/** Where the files of a release are downloaded from, unless moved. */
const GITHUB = 'https://github.com';

/** A GitHub URL, in the form a browser shows and in the form ssh clones. */
const GITHUB_URL = ['https://github\\.com/', 'git@github\\.com:'].map(
  (start) => new RegExp(`^${start}(${REPOSITORY_PART})/(${REPOSITORY_PART}?)(?:\\.git)?/?$`, 'i'),
);

/** One Plugin Release, as GitHub lists it: which one it is, and its files. */
export type PluginRelease = PluginReleaseOf & {
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
 * Release gives an empty list. GitHub lists a hundred Releases a page, newest
 * created first, so every page is read: a fix to an older MAJOR can be past
 * the first hundred, and a Release Version is not the order it was created
 * in.
 */
export async function pluginReleases(repository: string): Promise<PluginRelease[] | undefined> {
  const api = process.env['FIRSTMATE_GITHUB_API_URL'] || GITHUB_API;
  const releases: PluginRelease[] = [];
  // A page that names a page already read would ask GitHub forever.
  const read = new Set<string>();
  let url: string | undefined = `${api}/repos/${repository}/releases?per_page=100`;
  while (url !== undefined && !read.has(url)) {
    read.add(url);
    const response = await askGitHub(url, repository);
    if (response.status === 404 && read.size === 1) return undefined;
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for the releases of ${repository}.`);
    }
    const listed = (await response.json()) as unknown;
    if (!Array.isArray(listed)) {
      throw new Error(`GitHub did not answer a list of the releases of ${repository}.`);
    }
    for (const release of listed as GitHubRelease[]) {
      const found = pluginReleaseOf(release, repository);
      if (found !== undefined) releases.push(found);
    }
    url = nextPage(response);
  }
  return releases.sort((one, other) => compareVersions(other.version, one.version));
}

/**
 * GitHub's answer for one page of the releases. Its rate limit is refused
 * here, and so is a network that does not answer.
 */
async function askGitHub(url: string, repository: string): Promise<Response> {
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
    throw new Error(
      `GitHub could not be asked for the releases of ${repository}: ${faultReason(fault)}.`,
      { cause: fault },
    );
  }
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
  return response;
}

/** The page after this one, as GitHub names it in its `link` header, or nothing on the last. */
function nextPage(response: Response): string | undefined {
  const link = response.headers.get('link') ?? '';
  return /<([^>]+)>\s*;\s*rel="next"/.exec(link)?.[1];
}

/**
 * The Plugin Release a GitHub Release is, or nothing when it is none: a
 * draft, a prerelease, a tag that is not a Release Version, and a Release
 * that holds no `.tar.gz` at all. That last one is a repository's notes, not
 * an archive of the Plugin, so a repository with only those is cloned, as
 * before. The repository is the one GitHub names in the Release's own
 * address, in its true letter case: the release workflow names the archive
 * by it, and the operator may have typed the URL in another case.
 */
function pluginReleaseOf(release: GitHubRelease, asked: string): PluginRelease | undefined {
  if (release === null || release.draft === true || release.prerelease === true) return undefined;
  const tag = String(release.tag_name);
  const version = tag.slice(1);
  if (!tag.startsWith('v') || !RELEASE_VERSION.test(version)) return undefined;
  const assets = (Array.isArray(release.assets) ? release.assets : []).map((asset) =>
    String(asset?.name),
  );
  if (!assets.some((name) => name.endsWith('.tar.gz'))) return undefined;
  const page = URL.parse(String(release.html_url))?.pathname ?? '';
  const [, owner, repo] = RELEASE_PAGE.exec(page) ?? [];
  const repository = owner !== undefined && repo !== undefined ? `${owner}/${repo}` : asked;
  return { repository, version, assets };
}

/** The path of a Release's page on GitHub, `/<owner>/<repo>/releases/tag/<tag>`. */
const RELEASE_PAGE = new RegExp(`^/(${REPOSITORY_PART})/(${REPOSITORY_PART})/releases/`);

/**
 * When to try again, as a phrase, if GitHub answered with its rate limit, or
 * nothing for any other answer. GitHub says it with 429, or with 403 and no
 * requests left, or with 403 and `retry-after` for its secondary limit, which
 * leaves requests and still says no. It tells the time in `retry-after`
 * (seconds) or in `x-ratelimit-reset` (a Unix time in seconds).
 */
function rateLimitWait(response: Response): string | undefined {
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.get('retry-after') !== null));
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
  readonly html_url?: unknown;
  readonly assets?: readonly { readonly name?: unknown }[];
} | null;

/** Which of two Release Versions is newer: above zero when the first is, zero for the same. */
export function compareVersions(one: string, other: string): number {
  const a = one.split('.').map(Number);
  const b = other.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const step = (a[index] ?? 0) - (b[index] ?? 0);
    if (step !== 0) return step;
  }
  return 0;
}

/**
 * The platform and arch an archive is for, in Node's names (`linux`, `win32`,
 * `darwin`; `x64`, `arm64`). It is a parameter and not read from `process`
 * here, because the Place an install lands in can run on another platform
 * than the command line does, such as a `wsl` Place.
 */
export type ArchiveTarget = {
  readonly platform: string;
  readonly arch: string;
};

/** The target of the machine this process runs on: the target of a Place that is not another machine's. */
export function thisMachine(): ArchiveTarget {
  return { platform: process.platform, arch: process.arch };
}

/**
 * The names an archive of this Plugin Release may have for this target, in the
 * order they are taken: the archive for the target's platform and arch first,
 * and the archive for every platform second. Its name part is the
 * repository's name, which the release workflow names it by.
 */
function archiveNames(release: PluginRelease, target: ArchiveTarget): string[] {
  const name = release.repository.split('/')[1] ?? '';
  const base = `${name}-${release.version}`;
  return [`${base}-${target.platform}-${target.arch}.tar.gz`, `${base}.tar.gz`];
}

/**
 * The archive of this Plugin Release for this target, whole, gzipped, and
 * checked against the `.sha256` beside it. A Plugin Release with no archive
 * for the target, and none for every platform, is refused as missing, the
 * same kind as a file it lists that is not there to download, so a script
 * reads one exit code for "the release does not hold this file". Anything else is a thrown sentence, and nothing was written
 * anywhere.
 */
export async function downloadPluginRelease(
  release: PluginRelease,
  target: ArchiveTarget,
): Promise<Buffer> {
  const { repository, version } = release;
  const names = archiveNames(release, target);
  const archive = names.find((name) => release.assets.includes(name));
  if (archive === undefined) {
    throw refuse(
      'missing',
      `the Plugin Release ${version} of ${repository} holds no archive for ` +
        `${target.platform}-${target.arch} (${names.join(' or ')}). ` +
        `Ask the Plugin's author to publish one.`,
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
