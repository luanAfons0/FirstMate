/**
 * The release workflow, `plugin-release.yml`, as a Plugin's author meets it:
 * a tag of the Plugin's repository becomes a Plugin Release that `install`
 * takes (ADR-0033).
 *
 * The workflow does its work in one script, `scripts/plugin-release.ts`, and
 * GitHub Actions adds only the checkouts and the upload. So each test runs
 * that script as the workflow's step runs it: in a git repository of the
 * Plugin's own, at a tag, with the `test` and `build` commands the workflow
 * was called with. The files it writes are published, unchanged, to the fake
 * GitHub of `helpers/github.ts`, and `firstmate install` fetches them from
 * there. No test reaches GitHub, makes a tag on it or publishes a Release.
 *
 * The last test reads the workflow file itself, with a small read of its two
 * steps, for there is no YAML parser here. It proves the `test` and `build`
 * inputs reach the script's step through `env` and `run`, and that the
 * Release is made for the same tag and name, from the same folder. It cannot
 * prove that GitHub fills `${{ ... }}` as written, or that the `gh` calls
 * work; only a run on GitHub shows that.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitIn, hasGit } from './helpers/git.ts';
import { type FakeRelease, serveGitHub } from './helpers/github.ts';
import { bootHostIn, canStart, firstmate, fixture, makeHome } from './helpers/host.ts';

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));

/** The script the workflow's one step runs. */
const RELEASE_SCRIPT = join(REPOSITORY, 'scripts', 'plugin-release.ts');

/** This machine, and a platform it is not, in Node's names. */
const HERE = `${process.platform}-${process.arch}`;
const ELSEWHERE = HERE === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64';

/** Every test here needs git, as the workflow does. */
const NO_GIT = (await hasGit()) ? false : 'git is not installed';

/** What one run of the release script said, how it ended, and what it wrote. */
type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Each file it wrote into its out folder, by name. */
  readonly files: Readonly<Record<string, Buffer>>;
};

/** Whether a path is there. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * A git repository of a Plugin's own, named as GitHub would name it: the
 * files of a fixture Plugin, and these files beside them, in one commit.
 */
async function pluginRepository(
  t: test.TestContext,
  plugin: string,
  files: Readonly<Record<string, string>> = {},
): Promise<string> {
  const repository = join(await makeHome(t), 'both');
  await cp(fixture(plugin), repository, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repository, path)), { recursive: true });
    await writeFile(join(repository, path), text);
  }
  await gitIn(repository, ['init', '--quiet', '--initial-branch', 'main']);
  await gitIn(repository, ['add', '--all']);
  await gitIn(repository, ['commit', '--quiet', '-m', 'the Plugin']);
  return repository;
}

/**
 * Push a tag, as the author does, and run the workflow's step for it, with
 * the `test` and `build` inputs it was called with.
 */
async function release(
  t: test.TestContext,
  repository: string,
  tag: string,
  inputs: { readonly test?: string; readonly build?: string } = {},
): Promise<Run> {
  await gitIn(repository, ['tag', tag]);
  const out = await makeHome(t);
  const argv = [
    RELEASE_SCRIPT,
    tag,
    'both',
    out,
    '--test',
    inputs.test ?? '',
    '--build',
    inputs.build ?? '',
  ];
  const ran = await new Promise<Omit<Run, 'files'>>((done, fail) => {
    const child = spawn(process.execPath, argv, {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', fail);
    child.once('close', (code) => done({ code, stdout, stderr }));
  });
  const files: Record<string, Buffer> = {};
  for (const name of await readdir(out)) files[name] = await readFile(join(out, name));
  return { ...ran, files };
}

/** The GitHub Release the workflow's last step makes from what the run wrote. */
function githubRelease(tag: string, run: Run): FakeRelease {
  return { tag, assets: run.files };
}

test(
  'a tag of a Plugin with no build becomes a Plugin Release that install lands and the Host runs',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both');

    const ran = await release(t, repository, 'v1.2.0');

    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(Object.keys(ran.files).sort(), [
      'both-1.2.0.tar.gz',
      'both-1.2.0.tar.gz.sha256',
    ]);
    const github = await serveGitHub(t);
    github.publish('someone/both', githubRelease('v1.2.0', ran));
    const home = await makeHome(t);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/both'],
      github.env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    const landed = join(home, 'shelf', 'both');
    assert.ok(installed.stdout.includes('Release Version 1.2.0'), installed.stdout);
    assert.ok(await canStart(landed), 'mcp is still executable');
    assert.equal(
      await readFile(join(landed, 'web', 'nested', 'deep.txt'), 'utf8'),
      await readFile(fixture('both/web/nested/deep.txt'), 'utf8'),
      'the files are at the top of the archive',
    );

    const host = await bootHostIn(t, home);
    const page = await (await host.fetch('/')).text();
    assert.ok(page.includes('1 Running'), 'the Host runs the Plugin Server out of it');
  },
);

test(
  'with no build, the archive holds the files of the tag and leaves out every export-ignore path',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      '.gitattributes': '.gitattributes export-ignore\ntests/ export-ignore\ndocs/ export-ignore\n',
      'tests/mcp.test.ts': 'a test of the Plugin\n',
      'docs/notes.md': 'notes of the author\n',
    });
    // A file that is not in the tag does not ship, though the checkout holds it.
    await writeFile(join(repository, 'untracked.txt'), 'not in the tag\n');

    const ran = await release(t, repository, 'v0.1.0');

    assert.equal(ran.code, 0, ran.stderr);
    const github = await serveGitHub(t);
    github.publish('someone/both', githubRelease('v0.1.0', ran));
    const home = await makeHome(t);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/both'],
      github.env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    const landed = join(home, 'shelf', 'both');
    assert.deepEqual((await readdir(landed)).sort(), [
      '.firstmate-release.json',
      'mcp',
      'mcp.cmd',
      'private.txt',
      'web',
    ]);
  },
);

test(
  'the archive holds the bytes as committed, though the runner converts line endings',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', { 'lines.txt': 'one\ntwo\n' });
    // Git for Windows sets this on a runner; the archive must not feel it.
    await gitIn(repository, ['config', 'core.autocrlf', 'true']);

    const ran = await release(t, repository, 'v1.0.0');

    assert.equal(ran.code, 0, ran.stderr);
    const github = await serveGitHub(t);
    github.publish('someone/both', githubRelease('v1.0.0', ran));
    const home = await makeHome(t);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/both'],
      github.env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(await readFile(join(home, 'shelf', 'both', 'lines.txt'), 'utf8'), 'one\ntwo\n');
  },
);

test(
  'with a build, the archive holds release/ and nothing else, its files at the top',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'build.mjs':
        "import { cpSync } from 'node:fs';\n" +
        "for (const file of ['mcp', 'mcp.cmd', 'private.txt', 'web']) cpSync(file, 'release/' + file, { recursive: true });",
    });

    const ran = await release(t, repository, 'v2.0.0', { build: 'node build.mjs' });

    assert.equal(ran.code, 0, ran.stderr);
    const github = await serveGitHub(t);
    github.publish('someone/both', githubRelease('v2.0.0', ran));
    const home = await makeHome(t);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/both'],
      github.env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    const landed = join(home, 'shelf', 'both');
    assert.deepEqual((await readdir(landed)).sort(), [
      '.firstmate-release.json',
      'mcp',
      'mcp.cmd',
      'private.txt',
      'web',
    ]);
    assert.ok(await canStart(landed), 'the build kept the executable bit, and so does the archive');
  },
);

test(
  'platform folders under release/ give one archive each, and install takes the one for this machine',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'build.mjs':
        "import { cpSync, writeFileSync } from 'node:fs';\n" +
        `for (const platform of ['${HERE}', '${ELSEWHERE}']) {\n` +
        "  cpSync('web', 'release/' + platform + '/web', { recursive: true });\n" +
        "  writeFileSync('release/' + platform + '/for.txt', platform);\n" +
        '}',
    });

    const ran = await release(t, repository, 'v1.0.0', { build: 'node build.mjs' });

    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual(
      Object.keys(ran.files).sort(),
      [
        `both-1.0.0-${HERE}.tar.gz`,
        `both-1.0.0-${HERE}.tar.gz.sha256`,
        `both-1.0.0-${ELSEWHERE}.tar.gz`,
        `both-1.0.0-${ELSEWHERE}.tar.gz.sha256`,
      ].sort(),
    );
    const github = await serveGitHub(t);
    github.publish('someone/both', githubRelease('v1.0.0', ran));
    const home = await makeHome(t);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/both'],
      github.env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    const landed = join(home, 'shelf', 'both');
    assert.equal(await readFile(join(landed, 'for.txt'), 'utf8'), HERE);
    assert.ok(
      await exists(join(landed, 'web', 'index.html')),
      'the folder is the top of its archive',
    );
  },
);

test(
  'a tag that is not vMAJOR.MINOR.PATCH is refused before the test runs',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'test.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync('tested', '');",
    });

    for (const tag of ['v1.2', '1.2.0', 'v1.2.0-beta.1', 'v01.2.0']) {
      const ran = await release(t, repository, tag, { test: 'node test.mjs' });

      assert.equal(ran.code, 1, tag);
      assert.ok(ran.stderr.includes(tag), ran.stderr);
      assert.ok(ran.stderr.includes('vMAJOR.MINOR.PATCH'), ran.stderr);
      assert.equal(ran.stderr.trim().split('\n').length, 1, 'one sentence');
      assert.deepEqual(ran.files, {}, 'no archive');
      assert.ok(!(await exists(join(repository, 'tested'))), 'the test did not run');
    }
  },
);

test(
  'a failing test stops the release before the build, and nothing is archived',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'test.mjs': 'process.exit(3);',
      'build.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync('built', '');",
    });

    const ran = await release(t, repository, 'v1.0.0', {
      test: 'node test.mjs',
      build: 'node build.mjs',
    });

    assert.equal(ran.code, 1);
    assert.ok(ran.stderr.includes('node test.mjs'), ran.stderr);
    assert.deepEqual(ran.files, {}, 'no archive');
    assert.ok(!(await exists(join(repository, 'built'))), 'the build did not run');
  },
);

test('a passing test lets the release go on', { skip: NO_GIT }, async (t) => {
  const repository = await pluginRepository(t, 'both', {
    'test.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync('tested', '');",
  });

  const ran = await release(t, repository, 'v1.0.0', { test: 'node test.mjs' });

  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(await exists(join(repository, 'tested')), 'the test ran');
  assert.deepEqual(Object.keys(ran.files).sort(), [
    'both-1.0.0.tar.gz',
    'both-1.0.0.tar.gz.sha256',
  ]);
});

test(
  'a failing build, or one that writes no release/, is refused, and nothing is archived',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'fail.mjs': 'process.exit(2);',
      'nothing.mjs': '',
    });

    const failed = await release(t, repository, 'v1.0.0', { build: 'node fail.mjs' });
    const empty = await release(t, repository, 'v1.0.1', { build: 'node nothing.mjs' });

    assert.equal(failed.code, 1);
    assert.ok(failed.stderr.includes('node fail.mjs'), failed.stderr);
    assert.deepEqual(failed.files, {});
    assert.equal(empty.code, 1);
    assert.ok(empty.stderr.includes('release/'), empty.stderr);
    assert.equal(empty.stderr.trim().split('\n').length, 1, 'one sentence');
    assert.deepEqual(empty.files, {});
  },
);

test(
  'a release/ that mixes platform folders with other files is refused',
  {
    skip: NO_GIT,
  },
  async (t) => {
    const repository = await pluginRepository(t, 'both', {
      'build.mjs':
        "import { cpSync } from 'node:fs';\n" +
        `cpSync('web', 'release/${HERE}/web', { recursive: true });\n` +
        "cpSync('mcp', 'release/mcp');",
    });

    const ran = await release(t, repository, 'v1.0.0', { build: 'node build.mjs' });

    assert.equal(ran.code, 1);
    assert.ok(ran.stderr.includes('mcp'), ran.stderr);
    assert.equal(ran.stderr.trim().split('\n').length, 1, 'one sentence');
    assert.deepEqual(ran.files, {});
  },
);

/** One step of the workflow, as far as these tests read it. */
type Step = {
  readonly env: Readonly<Record<string, string>>;
  readonly run: string;
  readonly workingDirectory: string | undefined;
};

/** A GitHub Actions expression, as the workflow writes it. */
const expression = (inner: string): string => `$\u007B{ ${inner} }}`;

/** The leading spaces of a line. */
const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * The step of the workflow with this `name:`. There is no YAML parser in the
 * repository, so this reads only what the workflow's steps use: a `- name:`
 * line, scalar lines, an `env:` block of `KEY: value`, and a `run: |` block.
 */
function stepNamed(workflow: string, name: string): Step {
  const lines = workflow.split('\n');
  const first = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(first, -1, `the workflow has a step named "${name}"`);
  const dash = indentOf(lines[first] ?? '');
  const block: string[] = [];
  for (const line of lines.slice(first + 1)) {
    if (line.trim() !== '' && indentOf(line) <= dash) break;
    block.push(line);
  }
  const env: Record<string, string> = {};
  let run = '';
  let workingDirectory: string | undefined;
  for (let at = 0; at < block.length; at += 1) {
    const line = block[at] ?? '';
    const key = line.trim();
    const owner = indentOf(line);
    if (key === 'env:') {
      for (const entry of block.slice(at + 1)) {
        if (entry.trim() === '' || indentOf(entry) <= owner) break;
        const [name, ...value] = entry.trim().split(': ');
        env[name ?? ''] = value.join(': ');
      }
    } else if (key === 'run: |') {
      const body: string[] = [];
      for (const entry of block.slice(at + 1)) {
        if (entry.trim() !== '' && indentOf(entry) <= owner) break;
        body.push(entry.trim());
      }
      run = body.join('\n');
    } else if (key.startsWith('working-directory: ')) {
      workingDirectory = key.slice('working-directory: '.length);
    }
  }
  return { env, run, workingDirectory };
}

test('the workflow hands its inputs to the release script, and publishes under the tag and name the script used', async () => {
  const workflow = await readFile(
    join(REPOSITORY, '.github', 'workflows', 'plugin-release.yml'),
    'utf8',
  );
  assert.ok(workflow.includes('workflow_call:'), 'other workflows call it');
  const made = stepNamed(workflow, 'Check the tag, test, build, and make the archives');
  const published = stepNamed(workflow, 'Publish the Release');

  // The inputs reach the script: into the step's environment, and from there
  // to the script's two options.
  assert.equal(made.env['TEST'], expression('inputs.test'));
  assert.equal(made.env['BUILD'], expression('inputs.build'));
  assert.match(made.run, /node \.\.\/firstmate\/scripts\/plugin-release\.ts "\$TAG" "\$NAME" /);
  assert.match(made.run, /--test "\$TEST"/);
  assert.match(made.run, /--build "\$BUILD"/);

  // The Release is made for the tag, and under the name, the script used,
  // from the folder the script wrote into.
  assert.equal(published.env['TAG'], made.env['TAG']);
  assert.equal(published.env['NAME'], made.env['NAME']);
  assert.match(made.run, /"\$RUNNER_TEMP\/plugin-release"/);
  assert.equal(published.workingDirectory, `${expression('runner.temp')}/plugin-release`);
  assert.match(published.run, /gh release create "\$TAG" \.\/\* /);
  assert.match(published.run, /--title "\$NAME \$\{TAG#v\}"/);
});
