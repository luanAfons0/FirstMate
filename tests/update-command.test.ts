/**
 * `firstmate update <name>` moves a Plugin that is a git clone forward to its
 * upstream, with no merge, and restarts its Plugin Server through the running
 * Host. It runs nothing the Plugin ships, keeps the files git ignores, and
 * refuses in one sentence, changing nothing, whatever it cannot move cleanly.
 *
 * It needs no network: every clone comes from a bare repository made in the
 * test's own temporary directory, over `file://`, and each test skips itself
 * where git is absent. A Plugin in a `wsl` Place is updated through the fake
 * `wsl.exe`, which runs git here, in the folder that stands for the
 * distribution.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  addCommitTo,
  bareRepositoryOf,
  gitIn,
  hasGit,
  headOf,
  NO_GIT_CONFIGURATION,
} from './helpers/git.ts';
import { bootHostIn, firstmate, fixture, makeHome, until } from './helpers/host.ts';
import { stateOf } from './helpers/plugins.ts';
import { fakeWsl, NO_FAKE_WSL, type Wsl } from './helpers/wsl.ts';

/** A Plugin installed from git, and where everything about it is. */
type Installed = {
  readonly home: string;
  readonly bare: string;
  /** The Plugin's directory, which is the clone. */
  readonly clone: string;
};

/**
 * Install this fixture from a bare repository of its own, as an operator
 * installs a Plugin from its git URL. Nothing runs yet.
 */
async function installed(t: TestContext, plugin: string): Promise<Installed> {
  const bare = await bareRepositoryOf(t, plugin, plugin);
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', `file://${bare}`], NO_GIT_CONFIGURATION);
  assert.equal(done.code, 0, done.stderr);
  return { home, bare, clone: join(home, 'shelf', plugin) };
}

/** Run update, with the machine's own git configuration kept out of it. */
function update(home: string, ...argv: string[]): ReturnType<typeof firstmate> {
  return firstmate(home, ['update', ...argv], NO_GIT_CONFIGURATION);
}

/** The sentence update says when it moves, checked against the two commits. */
function assertMoved(said: string, name: string, from: string, to: string): void {
  const [, named, short, shortTo] =
    /^firstmate: updated (\S+) from (\w+) to (\w+)$/m.exec(said) ?? [];
  assert.equal(named, name, said);
  assert.ok(short !== undefined && shortTo !== undefined, said);
  assert.ok(short.length >= 7 && from.startsWith(short), `${short} is short for ${from}`);
  assert.ok(shortTo.length >= 7 && to.startsWith(shortTo), `${shortTo} is short for ${to}`);
}

/** Skip a test on a machine with no git. */
async function needsGit(t: TestContext): Promise<boolean> {
  if (await hasGit()) return true;
  t.skip('this machine has no git to clone with');
  return false;
}

test('a clone that is behind moves forward, with no Host running', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare, clone } = await installed(t, 'both');
  const before = await headOf(clone);
  const after = await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

  const updated = await update(home, 'both');

  assert.equal(updated.code, 0, updated.stderr);
  assertMoved(updated.stdout, 'both', before, after);
  assert.match(updated.stdout, /no Host runs.*starts with the Host/);
  assert.equal(await headOf(clone), after);
  assert.equal(await readFile(join(clone, 'web', 'index.html'), 'utf8'), 'the new Plugin Page\n');
});

test('a running Plugin Server is restarted, and the Host serves the new Plugin Page', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare, clone } = await installed(t, 'both');
  const host = await bootHostIn(t, home);
  await until(host, /both: private\.txt says/);
  const before = await headOf(clone);
  const after = await addCommitTo(bare, {
    'web/index.html': 'the new Plugin Page\n',
    'private.txt': 'the new words\n',
  });

  const updated = await update(home, 'both');

  assert.equal(updated.code, 0, updated.stderr);
  assertMoved(updated.stdout, 'both', before, after);
  assert.match(updated.stdout, /^firstmate: restarted both\. It is Running\.$/m);
  await until(host, /both: private\.txt says the new words/);
  assert.equal(await (await host.fetch('/p/both/')).text(), 'the new Plugin Page\n');
});

test('a Stopped Plugin that the update fixes comes back Running', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare } = await installed(t, 'quitter');
  const host = await bootHostIn(t, home);
  await until(host, /quitter: the Plugin Server gave up/);
  assert.equal(await stateOf(host, 'quitter'), 'stopped');
  await addCommitTo(bare, {
    mcp: { from: join(fixture('server-only'), 'mcp') },
    'mcp.cmd': { from: join(fixture('server-only'), 'mcp.cmd') },
  });

  const updated = await update(home, 'quitter');

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /^firstmate: restarted quitter\. It is Running\.$/m);
  assert.equal(await stateOf(host, 'quitter'), 'running');
});

test('a Plugin with no Plugin Server is not restarted, and its Plugin Page changes', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare } = await installed(t, 'page-only');
  const host = await bootHostIn(t, home);
  await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

  const updated = await update(home, 'page-only');

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(
    updated.stdout,
    /^firstmate: page-only ships no Plugin Server to restart\. Its Plugin Page has changed\.$/m,
  );
  assert.equal(await (await host.fetch('/p/page-only/')).text(), 'the new Plugin Page\n');
});

test('a Plugin with no Plugin Server and no Host running says its Plugin Page changed', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare } = await installed(t, 'page-only');
  await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

  const updated = await update(home, 'page-only');

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(
    updated.stdout,
    /^firstmate: page-only ships no Plugin Server to restart\. Its Plugin Page has changed\.$/m,
  );
  assert.doesNotMatch(updated.stdout, /starts with the Host/);
});

test('a clone that is current, or ahead, gets no output and no restart', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, clone } = await installed(t, 'both');
  const host = await bootHostIn(t, home);
  await until(host, /both: the Plugin Server is up/);

  const current = await update(home, 'both');
  assert.equal(current.code, 0, current.stderr);
  assert.equal(current.stdout, '');
  assert.equal(current.stderr, '');

  await writeFile(join(clone, 'mine.txt'), 'a commit of my own\n');
  await gitIn(clone, ['add', 'mine.txt']);
  await gitIn(clone, ['commit', '--quiet', '-m', 'mine']);
  const mine = await headOf(clone);

  const ahead = await update(home, 'both');
  assert.equal(ahead.code, 0, ahead.stderr);
  assert.equal(ahead.stdout, '');
  assert.equal(await headOf(clone), mine, 'my own commit is kept');
  assert.equal(
    host.output().match(/both: the Plugin Server is up/g)?.length,
    1,
    'nothing was restarted',
  );
});

test('a data file git ignores survives the update unchanged', async (t) => {
  if (!(await needsGit(t))) return;
  const bare = await bareRepositoryOf(t, 'both', 'both');
  await addCommitTo(bare, { '.gitignore': 'data/\n' });
  const home = await makeHome(t);
  const done = await firstmate(home, ['install', `file://${bare}`], NO_GIT_CONFIGURATION);
  assert.equal(done.code, 0, done.stderr);
  const clone = join(home, 'shelf', 'both');
  await mkdir(join(clone, 'data'));
  await writeFile(join(clone, 'data', 'notes.db'), "the operator's own data\n");
  await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

  const updated = await update(home, 'both');

  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /updated both/);
  assert.equal(
    await readFile(join(clone, 'data', 'notes.db'), 'utf8'),
    "the operator's own data\n",
  );
});

/** What a refusal must leave as it was: the commit, and every file git sees. */
async function stateOfClone(clone: string): Promise<string> {
  const head = await headOf(clone);
  const page = await readFile(join(clone, 'web', 'index.html'), 'utf8');
  const status = await gitIn(clone, ['status', '--porcelain', '--untracked-files=all']);
  return `${head}\n${page}\n${status}`;
}

/**
 * Run update on a clone that has fallen behind its upstream and has been put
 * in a state it must refuse, and check that it refused with exit code 3, in
 * one sentence, and changed nothing.
 */
async function assertRefused(
  t: TestContext,
  arrange: (clone: string, bare: string) => Promise<void>,
  sentence: RegExp,
): Promise<void> {
  const { home, bare, clone } = await installed(t, 'both');
  await arrange(clone, bare);
  await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });
  const before = await stateOfClone(clone);

  const refused = await update(home, 'both');

  assert.equal(refused.code, 3, refused.stderr);
  assert.match(refused.stderr, sentence);
  assert.equal(refused.stderr.trimEnd().split('\n').length, 1, 'in one line');
  assert.equal(refused.stdout, '');
  assert.equal(await stateOfClone(clone), before, 'nothing changed');
}

test('a tracked local change is refused, and kept', async (t) => {
  if (!(await needsGit(t))) return;
  await assertRefused(
    t,
    (clone) => writeFile(join(clone, 'web', 'index.html'), 'my own edit\n'),
    /^firstmate: both has local changes to tracked files, which update would not keep/,
  );
});

test('a detached HEAD is refused', async (t) => {
  if (!(await needsGit(t))) return;
  await assertRefused(
    t,
    async (clone) => void (await gitIn(clone, ['checkout', '--quiet', '--detach'])),
    /^firstmate: both is on no branch, at a detached HEAD, .*: check out the branch it follows, then run update again\.$/m,
  );
});

test('a branch with no upstream is refused', async (t) => {
  if (!(await needsGit(t))) return;
  await assertRefused(
    t,
    async (clone) => void (await gitIn(clone, ['branch', '--unset-upstream'])),
    /^firstmate: both's branch main has no upstream, .*: set one with git branch --set-upstream-to, then run update again\.$/m,
  );
});

test('a branch that has diverged from its upstream is refused', async (t) => {
  if (!(await needsGit(t))) return;
  await assertRefused(
    t,
    async (clone) => {
      await writeFile(join(clone, 'mine.txt'), 'a commit of my own\n');
      await gitIn(clone, ['add', 'mine.txt']);
      await gitIn(clone, ['commit', '--quiet', '-m', 'mine']);
    },
    /^firstmate: both has commits its upstream does not have.*without a merge: merge or rebase it by hand, then run update again\.$/m,
  );
});

test('an untracked file the new commit would overwrite is refused, and kept', async (t) => {
  if (!(await needsGit(t))) return;
  await assertRefused(
    t,
    async (clone, bare) => {
      await addCommitTo(bare, { 'web/new.txt': "the author's file\n" });
      await writeFile(join(clone, 'web', 'new.txt'), 'my own file\n');
    },
    /^firstmate: the update of both would overwrite untracked files, web\/new\.txt: move them/,
  );
});

test('an ignored file the new commit would track is refused, and kept', async (t) => {
  if (!(await needsGit(t))) return;
  let data = '';
  await assertRefused(
    t,
    async (clone, bare) => {
      // The operator's own data, which git ignores in this clone alone.
      await writeFile(join(clone, '.git', 'info', 'exclude'), 'data/\n');
      await mkdir(join(clone, 'data'));
      data = join(clone, 'data', 'notes.db');
      await writeFile(data, "the operator's own data\n");
      await addCommitTo(bare, { 'data/notes.db': "the author's file\n" });
    },
    /^firstmate: the update of both would overwrite untracked files, data\/notes\.db: move them/,
  );
  assert.equal(await readFile(data, 'utf8'), "the operator's own data\n");
});

test('a Plugin whose directory is gone is refused, with what to do', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, clone } = await installed(t, 'both');
  await rename(clone, `${clone}.gone`);

  const refused = await update(home, 'both');

  assert.equal(refused.code, 3, refused.stderr);
  assert.equal(
    refused.stderr,
    `firstmate: ${clone} is not a directory: put the Plugin back there, ` +
      'or take it out with firstmate remove both.\n',
  );
});

test('a copied Plugin is refused, with how to update it by hand', async (t) => {
  if (!(await needsGit(t))) return;
  const home = await makeHome(t);
  const copied = await firstmate(home, ['install', fixture('both')]);
  assert.equal(copied.code, 0, copied.stderr);

  const refused = await update(home, 'both');

  assert.equal(refused.code, 3, refused.stderr);
  assert.match(
    refused.stderr,
    /^firstmate: both at .* is not a git clone of its own, so update cannot move it: .*move its data out, then firstmate remove both and install it again\.\n$/,
  );
});

test('a directory inside a larger repository is refused, and the repository stays', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare, clone } = await installed(t, 'both');
  const added = await firstmate(home, ['add', 'inner', join(clone, 'web')]);
  assert.equal(added.code, 0, added.stderr);
  await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });
  const before = await stateOfClone(clone);

  const refused = await update(home, 'inner');

  assert.equal(refused.code, 3, refused.stderr);
  assert.match(refused.stderr, /is inside a larger git repository and is not its top/);
  assert.equal(await stateOfClone(clone), before);
});

test('a hook planted in the clone does not run', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare, clone } = await installed(t, 'both');
  const ran = join(home, 'a hook ran');
  const hook = `#!/bin/sh\necho "$0" >> '${ran}'\n`;
  for (const name of ['post-merge', 'reference-transaction']) {
    await writeFile(join(clone, '.git', 'hooks', name), hook);
    await chmod(join(clone, '.git', 'hooks', name), 0o755);
  }
  const monitor = join(home, 'monitor');
  await writeFile(monitor, hook);
  await chmod(monitor, 0o755);
  await gitIn(clone, ['config', 'core.fsmonitor', monitor]);
  const after = await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

  const updated = await update(home, 'both');

  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(await headOf(clone), after);
  await assert.rejects(readFile(ran), 'no hook ran, and no monitor');
  // And the hooks were live: git run by hand does run them.
  await gitIn(clone, ['commit', '--quiet', '--allow-empty', '-m', 'by hand']);
  assert.match(await readFile(ran, 'utf8'), /reference-transaction/);
});

test('an ext:: remote the clone allows does not run', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, clone } = await installed(t, 'both');
  const ran = join(home, 'transport-ran');
  await gitIn(clone, ['config', 'protocol.ext.allow', 'always']);
  await gitIn(clone, ['remote', 'set-url', 'origin', `ext::sh -c touch% ${ran}`]);
  const before = await stateOfClone(clone);

  const updated = await update(home, 'both');

  assert.equal(updated.code, 1, updated.stderr);
  assert.match(updated.stderr, /^firstmate: git could not fetch both's upstream: /);
  assert.equal(existsSync(ran), false, 'no transport ran');
  assert.equal(await stateOfClone(clone), before);
  // And the transport was live: git run by hand does run it.
  await gitIn(clone, ['fetch', '--quiet']).catch(() => undefined);
  assert.equal(existsSync(ran), true, 'git run by hand runs the transport');
});

test('git not on the PATH, or a failed fetch, fails with a sentence', async (t) => {
  if (!(await needsGit(t))) return;
  const { home, bare, clone } = await installed(t, 'both');
  const before = await stateOfClone(clone);

  const noGit = await firstmate(home, ['update', 'both'], {
    ...NO_GIT_CONFIGURATION,
    PATH: await makeHome(t),
  });
  assert.equal(noGit.code, 1, noGit.stderr);
  assert.equal(
    noGit.stderr,
    'firstmate: git is not on the PATH, and update needs it. Install git.\n',
  );

  await rename(bare, `${bare}.gone`);
  const noFetch = await update(home, 'both');
  assert.equal(noFetch.code, 1, noFetch.stderr);
  assert.match(noFetch.stderr, /^firstmate: git could not fetch both's upstream: \S/);
  assert.equal(noFetch.stderr.trimEnd().split('\n').length, 1, 'in one line');
  assert.equal(await stateOfClone(clone), before);
});

test('an unknown name is refused as restart refuses it, and no name is typed wrong', async (t) => {
  const home = await makeHome(t);

  const unknown = await update(home, 'nobody');
  assert.equal(unknown.code, 4);
  assert.equal(unknown.stderr, 'firstmate: no Plugin named nobody is registered.\n');

  for (const argv of [[], ['both', 'more']]) {
    const wrong = await update(home, ...argv);
    assert.equal(wrong.code, 2, argv.join(' '));
    assert.match(
      wrong.stderr,
      /^firstmate: update takes one Plugin Name: name the Plugin to update\./,
    );
  }
});

/** Where `install` clones a Plugin named both in the fake distribution's Shelf. */
const INSIDE = '/home/mate/.firstmate/shelf/both';

/** A Plugin installed from git into a `wsl` Place, and the fake WSL it is in. */
type InWsl = Installed & { readonly wsl: Wsl; readonly env: NodeJS.ProcessEnv };

/** Install the `both` fixture from its bare repository into a `wsl` Place. */
async function installedInWsl(t: TestContext): Promise<InWsl> {
  const bare = await bareRepositoryOf(t, 'both', 'both');
  const home = await makeHome(t);
  const wsl = await fakeWsl(t, ['Debian']);
  const env = { ...wsl.env, ...NO_GIT_CONFIGURATION };
  const placed = await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], env);
  assert.equal(placed.code, 0, placed.stderr);
  const done = await firstmate(home, ['install', `file://${bare}`, '--place', 'deb'], env);
  assert.equal(done.code, 0, done.stderr);
  return { home, bare, clone: join(wsl.root, INSIDE), wsl, env };
}

test(
  'a clone in a wsl Place moves forward through wsl.exe, with hooks and fsmonitor off',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await needsGit(t))) return;
    const { home, bare, clone, wsl, env } = await installedInWsl(t);
    const before = await headOf(clone);
    const after = await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });

    const updated = await firstmate(home, ['update', 'both'], env);

    assert.equal(updated.code, 0, updated.stderr);
    assertMoved(updated.stdout, 'both', before, after);
    assert.equal(await headOf(clone), after);
    const calls = (await wsl.calls()).filter((line) => / git /.test(line));
    assert.ok(
      calls.some((line) => / git .* fetch /.test(line)),
      calls.join('\n'),
    );
    for (const line of calls) {
      assert.ok(line.startsWith(`wsl.exe -d Debian --cd ${INSIDE} --exec `), line);
      assert.match(
        line,
        / git -c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false -c protocol\.ext\.allow=never /,
      );
    }
  },
);

test(
  'a tracked local change in a wsl Place is refused as in a local Place, and kept',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await needsGit(t))) return;
    const { home, bare, clone, env } = await installedInWsl(t);
    await writeFile(join(clone, 'web', 'index.html'), 'my own edit\n');
    await addCommitTo(bare, { 'web/index.html': 'the new Plugin Page\n' });
    const before = await stateOfClone(clone);

    const refused = await firstmate(home, ['update', 'both'], env);

    assert.equal(refused.code, 3, refused.stderr);
    assert.match(
      refused.stderr,
      /^firstmate: both has local changes to tracked files, which update would not keep/,
    );
    assert.equal(refused.stderr.trimEnd().split('\n').length, 1, 'in one line');
    assert.equal(await stateOfClone(clone), before, 'nothing changed');
  },
);

test(
  'git missing in the distribution fails with a sentence that names it',
  { skip: NO_FAKE_WSL },
  async (t) => {
    if (!(await needsGit(t))) return;
    const { home, clone, wsl, env } = await installedInWsl(t);
    const before = await stateOfClone(clone);
    // The fake runs its command with this PATH alone: env is there, git is not.
    const tools = await makeHome(t);
    await symlink(onThePath('env'), join(tools, 'env'));
    const bin = (wsl.env['PATH'] ?? '').split(delimiter)[0] ?? '';

    const noGit = await firstmate(home, ['update', 'both'], {
      ...env,
      PATH: `${bin}${delimiter}${tools}`,
    });

    assert.equal(noGit.code, 1, noGit.stderr);
    assert.equal(
      noGit.stderr,
      'firstmate: git is not installed in Debian, and update needs it. Install git there.\n',
    );
    assert.equal(await stateOfClone(clone), before);
  },
);

/** Where this machine has a program, as the shell finds it on PATH. */
function onThePath(program: string): string {
  const found = (process.env['PATH'] ?? '')
    .split(delimiter)
    .map((directory) => join(directory, program))
    .find((path) => existsSync(path));
  assert.ok(found !== undefined, `${program} is on the PATH`);
  return found;
}
