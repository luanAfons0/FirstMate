/**
 * The Mate in a `wsl` Place: with `place` naming one, firstmate ask runs the
 * Agent inside its distribution through `wsl.exe`, in the home directory of
 * the distribution's user, as a Plugin Server runs there (ADR-0021). The
 * Agent is looked for inside the distribution, on the PATH `wsl.exe` gives
 * it, which is often not the one a terminal there has, so a refusal says it.
 *
 * The distribution is the fake from `helpers/wsl.ts`, and the Agent the fake
 * from `helpers/agents.ts`, put on the PATH the fake distribution runs with.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { CONTEXT_ENDS, fakeClaude, fakeCodex, type FakeAgent } from './helpers/agents.ts';
import { firstmate, makeHome } from './helpers/host.ts';
import { pathWith } from './helpers/path.ts';
import { fakeWsl, NO_FAKE_WSL, type Wsl } from './helpers/wsl.ts';

/** A home with the wsl Place deb, of the distribution Debian, and the Mate in it. */
async function aboard(
  t: TestContext,
  wsl: Wsl,
  mate: Readonly<Record<string, string>>,
): Promise<string> {
  const home = await makeHome(t);
  const added = await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], {
    PATH: await inside(t, wsl),
  });
  assert.equal(added.code, 0, added.stderr);
  const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as object;
  await writeFile(join(home, 'settings.json'), JSON.stringify({ ...settings, mate }));
  return home;
}

/**
 * The PATH of the fake distribution: the fake `wsl.exe`, a shell, and the
 * fake Agent when one is given. No real Agent of this machine is on it.
 */
async function inside(t: TestContext, wsl: Wsl, agent?: FakeAgent): Promise<string> {
  const first = (env: Readonly<Record<string, string>>): string =>
    (env['PATH'] ?? '').split(delimiter)[0] ?? '';
  const agentBin = agent === undefined ? [] : [first(agent.env)];
  return [first(wsl.env), ...agentBin, await pathWith(t, ['sh'])].join(delimiter);
}

test(
  'with place naming a wsl Place, the Agent runs through wsl.exe in its distribution and home',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const claude = await fakeClaude(t);
    const home = await aboard(t, wsl, { agent: 'claude', place: 'deb' });

    const asked = await firstmate(home, ['ask', 'Where is the treasure?'], {
      PATH: await inside(t, wsl, claude),
    });

    assert.equal(asked.code, 0, asked.stderr);
    assert.equal(asked.stdout, 'Ahoy.\n');
    const [call, ...more] = await claude.calls();
    assert.deepEqual(more, []);
    assert.ok(call?.stdin.endsWith(`${CONTEXT_ENDS}Where is the treasure?`), call?.stdin);
    assert.equal(call?.cwd, join(wsl.root, wsl.home), "the home of the distribution's user");
    const started = (await wsl.calls()).at(-1) ?? '';
    assert.ok(
      started.startsWith(`wsl.exe -d Debian --cd ${wsl.home} --exec ${claude.program} -p `),
      started,
    );
    const [conversation] = await readdir(join(home, 'conversations'));
    const head = (await readFile(join(home, 'conversations', conversation ?? ''), 'utf8')).split(
      '\n',
    )[0];
    assert.equal(JSON.parse(head ?? '').place, 'deb');
  },
);

test(
  'a Conversation of a wsl Place resumes inside that distribution',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const codex = await fakeCodex(t);
    const home = await aboard(t, wsl, { agent: 'codex', place: 'deb' });
    const env = { PATH: await inside(t, wsl, codex) };
    const first = await firstmate(home, ['ask', 'Where is the treasure?'], env);
    assert.equal(first.code, 0, first.stderr);
    const id = first.stderr.split('\n')[0] ?? '';

    const again = await firstmate(home, ['ask', '--conversation', id, 'And now?'], env);

    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, 'Ahoy.\n');
    const resumed = (await wsl.calls()).at(-1) ?? '';
    assert.match(resumed, /^wsl\.exe -d Debian --cd \/home\/mate --exec \S+ exec resume /);
    assert.equal((await codex.calls()).length, 2);
  },
);

test(
  'an Agent not on the PATH of a wsl Place is refused, with that PATH, and nothing is kept',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const home = await aboard(t, wsl, { agent: 'claude', place: 'deb' });
    const path = await inside(t, wsl);

    const asked = await firstmate(home, ['ask', 'Anyone there?'], { PATH: path });

    assert.equal(asked.code, 4, asked.stderr);
    assert.equal(asked.stdout, '');
    assert.equal(
      asked.stderr,
      `firstmate: cannot find claude on the PATH of the deb Place, which is ${path}. ` +
        'Install Claude there, or set "program" in the Mate settings to where it is.\n',
    );
    assert.deepEqual(await readdir(join(home, 'conversations')).catch(() => []), []);
    const [, looked, ...more] = await wsl.calls();
    assert.match(looked ?? '', /^wsl\.exe -d Debian --exec sh -c /, 'it looked inside');
    assert.deepEqual(more, [], 'and started nothing');
  },
);

test(
  'the program of the Mate settings is looked for inside the wsl Place',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const claude = await fakeClaude(t);
    const home = await aboard(t, wsl, { agent: 'claude', place: 'deb', program: claude.program });
    const env = { PATH: await inside(t, wsl) };

    const asked = await firstmate(home, ['ask', 'Where is the treasure?'], env);

    assert.equal(asked.code, 0, asked.stderr);
    assert.equal(asked.stdout, 'Ahoy.\n');

    const missing = '/home/mate/.local/bin/claude';
    const elsewhere = await aboard(t, wsl, { agent: 'claude', place: 'deb', program: missing });
    const refused = await firstmate(elsewhere, ['ask', 'Anyone there?'], env);

    assert.equal(refused.code, 4, refused.stderr);
    assert.equal(
      refused.stderr,
      `firstmate: cannot find claude at ${missing} in the deb Place. ` +
        'Install Claude there, or set "program" in the Mate settings to where it is.\n',
    );
  },
);

test(
  'a wsl Place whose distribution does not answer is refused, and runs no Agent',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const wsl = await fakeWsl(t, ['Debian']);
    const claude = await fakeClaude(t);
    const home = await aboard(t, wsl, { agent: 'claude', place: 'deb' });
    const file = join(home, 'settings.json');
    const settings = JSON.parse(await readFile(file, 'utf8')) as { places: object[] };
    const gone = { ...settings, places: [{ ...settings.places[0], distribution: 'Gone' }] };
    await writeFile(file, JSON.stringify(gone));

    const asked = await firstmate(home, ['ask', 'Anyone there?'], {
      PATH: await inside(t, wsl, claude),
    });

    assert.equal(asked.code, 3, asked.stderr);
    assert.equal(
      asked.stderr,
      'firstmate: the distribution Gone did not answer: ' +
        'There is no distribution with the supplied name.\n',
    );
    assert.deepEqual(await claude.calls(), []);
  },
);
