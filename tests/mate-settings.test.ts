/**
 * The Mate settings: the `mate` key of the settings file, which says which
 * Agent the Mate runs, with which model and effort, in which Place, and from
 * which program. `firstmate ask` reads them, so it is the seam they are
 * tested through, with a fake `claude` that writes down how it was started.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeClaude } from './helpers/agents.ts';
import { DEFAULT_PLACE, firstmate, fixture, makeHome } from './helpers/host.ts';
import { pathWith } from './helpers/path.ts';

/** Write these settings, whole, as an operator or the App would. */
async function settle(home: string, settings: unknown): Promise<void> {
  await writeFile(join(home, 'settings.json'), `${JSON.stringify(settings)}\n`);
}

/** The settings as they are written now. */
async function settingsOf(home: string): Promise<object> {
  return JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as object;
}

/** The head of the Conversation whose ID ask said first on stderr. */
async function headOf(home: string, stderr: string): Promise<Record<string, unknown>> {
  const id = stderr.split('\n')[0] ?? '';
  const text = await readFile(join(home, 'conversations', `${id}.jsonl`), 'utf8');
  return JSON.parse(text.split('\n')[0] ?? '') as Record<string, unknown>;
}

/** The words after the flag in one start of the Agent, or nothing when it is not there. */
function after(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : argv[at + 1];
}

test('the model and the effort of the Mate settings are passed to claude', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', model: 'opus', effort: 'xhigh' } });

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const argv = (await claude.calls())[0]?.argv ?? [];
  assert.equal(after(argv, '--model'), 'opus');
  assert.equal(after(argv, '--effort'), 'xhigh');
  assert.equal(argv.filter((word) => word.startsWith('--model')).length, 1);
  assert.equal(argv.filter((word) => word.startsWith('--effort')).length, 1);
});

test('an empty model or effort, or no mate key at all, leaves claude its own default', async (t) => {
  const claude = await fakeClaude(t);
  for (const settings of [{ mate: { agent: 'claude', model: '', effort: '' } }, {}]) {
    const home = await makeHome(t);
    await settle(home, settings);

    const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

    assert.equal(asked.code, 0, asked.stderr);
    const argv = (await claude.calls()).at(-1)?.argv ?? [];
    assert.deepEqual(argv.slice(6), [], `no model and no effort: ${argv.join(' ')}`);
    const head = await headOf(home, asked.stderr);
    assert.equal(head['agent'], 'claude');
    assert.ok(!('model' in head) && !('effort' in head), JSON.stringify(head));
  }
});

test("a new Conversation's head records the settings it started with", async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', model: 'sonnet[1m]', effort: 'low' } });

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const head = await headOf(home, asked.stderr);
  assert.deepEqual([head['agent'], head['model'], head['effort']], ['claude', 'sonnet[1m]', 'low']);
});

test('a resumed Conversation keeps the model and the effort it started with', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', model: 'opus', effort: 'max' } });
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);
  const id = first.stderr.split('\n')[0] ?? '';
  await settle(home, { mate: { agent: 'claude', model: 'haiku', effort: 'low' } });

  const next = await firstmate(home, ['ask', '--conversation', id, 'How far?'], claude.env);

  assert.equal(next.code, 0, next.stderr);
  const argv = (await claude.calls())[1]?.argv ?? [];
  assert.ok(argv.includes('--resume'), argv.join(' '));
  assert.equal(after(argv, '--model'), 'opus');
  assert.equal(after(argv, '--effort'), 'max');
});

test('the program of the Mate settings is started in place of claude on PATH', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', program: claude.program } });
  const bare = { ...claude.env, PATH: await pathWith(t, []) };

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], bare);

  assert.equal(asked.code, 0, asked.stderr);
  assert.equal(asked.stdout, 'Ahoy.\n');
  assert.equal((await claude.calls()).length, 1);
});

test('a program of the Mate settings that is not there is refused in one sentence', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const missing = join(claude.home, 'nowhere', 'claude');
  await settle(home, { mate: { agent: 'claude', program: missing } });

  const asked = await firstmate(home, ['ask', 'Anyone there?'], claude.env);

  assert.equal(asked.code, 4, asked.stderr);
  assert.equal(asked.stdout, '');
  assert.equal(
    asked.stderr,
    `firstmate: cannot find claude at ${missing} in the ${DEFAULT_PLACE} Place. ` +
      'Install Claude there, or set "program" in the Mate settings to where it is.\n',
  );
  assert.deepEqual(await claude.calls(), [], 'the claude on PATH is not started instead');
});

test('a command that writes the settings keeps the Mate settings', async (t) => {
  const mate = { agent: 'claude', model: 'opus', effort: '', place: DEFAULT_PLACE, program: '' };
  const home = await makeHome(t);
  const added = await firstmate(home, ['add', 'both', fixture('both')]);
  assert.equal(added.code, 0, added.stderr);
  await settle(home, { mate });

  for (const argv of [
    ['bind', 'Ctrl+Alt+F9', 'both'],
    ['order', 'both', '1'],
    ['place', 'add', 'galley', 'local'],
  ]) {
    const wrote = await firstmate(home, argv);

    assert.equal(wrote.code, 0, `${argv.join(' ')}: ${wrote.stderr}`);
    const written = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8')) as {
      mate?: unknown;
    };
    assert.deepEqual(written.mate, mate, argv.join(' '));
  }
});

test('a damaged Mate setting fails every command loudly, in one sentence', async (t) => {
  const damage: [unknown, RegExp][] = [
    ['claude', /need to be a JSON object/],
    [{}, /need "agent" to be "claude" or "codex"/],
    [{ agent: 'parrot' }, /need "agent" to be "claude" or "codex", and not "parrot"/],
    [{ agent: 'claude', model: 42 }, /need "model" to be a string/],
    [{ agent: 'claude', model: 'opus&calc' }, /need "model" to be a model name.*"opus&calc"/],
    [{ agent: 'claude', model: 'opus 4' }, /need "model" to be a model name/],
    [{ agent: 'claude', model: '--resume' }, /need "model" to be a model name/],
    [{ agent: 'claude', model: '"%PATH%"' }, /need "model" to be a model name/],
    [{ agent: 'claude', effort: 'extreme' }, /"effort" to be one of low, medium, high, xhigh, max/],
    [{ agent: 'claude', effort: 'minimal' }, /"effort" to be one of .* for Claude.*"minimal"/],
    [
      { agent: 'codex', effort: 'ultra' },
      /"effort" to be one of minimal, low, medium, high, xhigh, max for Codex.*"ultra"/,
    ],
    [{ agent: 'claude', place: true }, /need "place" to be a string/],
    [{ agent: 'claude', program: 'bin/claude' }, /need "program" to be an absolute path/],
    [{ agent: 'claude', colour: 'red' }, /may hold only "agent", .*and not "colour"/],
  ];
  const claude = await fakeClaude(t);

  for (const [mate, said] of damage) {
    const home = await makeHome(t);
    const added = await firstmate(home, ['add', 'both', fixture('both')]);
    assert.equal(added.code, 0, added.stderr);
    await settle(home, { mate });
    for (const argv of [['list'], ['bind', 'Ctrl+Alt+F9', 'both'], ['ask', 'Hello?']]) {
      const broken = await firstmate(home, argv, claude.env);

      const where = `${JSON.stringify(mate)}, ${argv.join(' ')}`;
      assert.equal(broken.code, 1, where);
      assert.equal(broken.stdout, '', where);
      assert.match(broken.stderr, said, where);
      assert.match(
        broken.stderr,
        /^firstmate: The Mate settings in the settings at .*settings\.json/,
      );
      assert.equal(broken.stderr.trimEnd().split('\n').length, 1, `one sentence: ${where}`);
    }
  }
  assert.deepEqual(await claude.calls(), [], 'no Agent ran');
});

test('the Place of the Mate settings is the Place the Agent runs in', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const added = await firstmate(home, ['place', 'add', 'galley', 'local'], claude.env);
  assert.equal(added.code, 0, added.stderr);
  await settle(home, { ...(await settingsOf(home)), mate: { agent: 'claude', place: 'galley' } });

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  assert.equal((await headOf(home, asked.stderr))['place'], 'galley');
});

test('a Place of the Mate settings that is not there is a damaged setting', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', place: 'galley' } });

  for (const argv of [['list'], ['place'], ['ask', 'Where is the treasure?']]) {
    const broken = await firstmate(home, argv, claude.env);

    assert.equal(broken.code, 1, `${argv.join(' ')}: ${broken.stderr}`);
    assert.match(
      broken.stderr,
      new RegExp(
        '^firstmate: The Mate settings in the settings at .* need "place" to name a Place, ' +
          `one of ${DEFAULT_PLACE}, and not "galley"\\.\\n$`,
      ),
    );
  }
  assert.deepEqual(await claude.calls(), []);
});

test('the Place the Mate runs in is not removed, so the Mate settings stay whole', async (t) => {
  const home = await makeHome(t);
  const added = await firstmate(home, ['place', 'add', 'galley', 'local']);
  assert.equal(added.code, 0, added.stderr);
  await settle(home, { ...(await settingsOf(home)), mate: { agent: 'claude', place: 'galley' } });

  const refused = await firstmate(home, ['place', 'remove', 'galley']);

  assert.equal(refused.code, 5, refused.stderr);
  assert.equal(
    refused.stderr,
    'firstmate: galley is the Place the Mate runs in. Choose another for the Mate first.\n',
  );
  assert.equal((await firstmate(home, ['list'])).code, 0, 'every command still runs');
});

test('a Conversation resumes with the program it started with, whatever the settings say', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await settle(home, { mate: { agent: 'claude', program: claude.program } });
  const bare = { ...claude.env, PATH: await pathWith(t, []) };
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], bare);
  assert.equal(first.code, 0, first.stderr);
  assert.equal((await headOf(home, first.stderr))['program'], claude.program);
  await settle(home, { mate: { agent: 'claude' } });
  const id = first.stderr.split('\n')[0] ?? '';

  const next = await firstmate(home, ['ask', '--conversation', id, 'How far?'], bare);

  assert.equal(next.code, 0, next.stderr);
  assert.equal(next.stdout, 'Ahoy.\n');
  assert.equal((await claude.calls()).length, 2);
});

test('the width of the Mate panel is kept in the Mate settings, and every command keeps it', async (t) => {
  const home = await makeHome(t);
  await settle(home, { mate: { agent: 'claude', width: 520 } });

  const bound = await firstmate(home, ['order']);

  assert.equal(bound.code, 0, bound.stderr);
  const placed = await firstmate(home, ['place', 'add', 'galley', 'local']);
  assert.equal(placed.code, 0, placed.stderr);
  assert.deepEqual((await settingsOf(home)) as Record<string, unknown>, {
    places: [{ name: 'galley', kind: 'local' }],
    mate: { agent: 'claude', width: 520 },
  });
});

test('a width of the Mate panel that is not a whole number of pixels fails every command', async (t) => {
  const home = await makeHome(t);
  await settle(home, { mate: { agent: 'claude', width: '520' } });

  const listed = await firstmate(home, ['list']);

  assert.equal(listed.code, 1, listed.stderr);
  assert.match(listed.stderr, /need "width" to be a whole number of pixels/);
});
