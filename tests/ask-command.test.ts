/**
 * firstmate ask: the Mate from a terminal. It runs the operator's own Agent,
 * prints the answer as it arrives, and keeps the Conversation in the home
 * directory, where the App's Recents read it too. It needs no Host.
 *
 * The Agent is a fake `claude` on PATH, which writes what the real one writes.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeClaude } from './helpers/agents.ts';
import { DEFAULT_PLACE, firstmate, firstmateRunning, makeHome } from './helpers/host.ts';
import { pathWith } from './helpers/path.ts';

/** The ID a UUID has, as a new Claude session and a Conversation are named. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every line of the one Conversation file in this home directory, read as JSON. */
async function conversation(home: string, id: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(home, 'conversations', `${id}.jsonl`), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The Conversation ID ask said on stderr: its first line. */
function idOf(stderr: string): string {
  return stderr.split('\n')[0] ?? '';
}

test('ask runs claude with a new session, and sends the question on stdin alone', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);

  const asked = await firstmate(home, ['ask', 'Where', 'is', 'the', 'treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const [call, ...more] = await claude.calls();
  assert.equal(more.length, 0, 'claude ran once');
  assert.ok(call !== undefined);
  const [print, format, json, verbose, sessionFlag, session, ...rest] = call.argv;
  assert.deepEqual(
    [print, format, json, verbose, sessionFlag],
    ['-p', '--output-format', 'stream-json', '--verbose', '--session-id'],
  );
  assert.match(session ?? '', UUID);
  assert.deepEqual(rest, [], 'no model, no effort and no permission mode: Claude decides');
  assert.equal(call.stdin, 'Where is the treasure?');
  assert.ok(!call.argv.some((word) => word.includes('treasure')), 'the question is no argument');
  assert.equal(call.cwd, claude.home, "in the operator's home directory");
});

test('ask prints the answer on stdout, and the Conversation ID on stderr', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ say: 'Under the palm.' }, { say: 'Dig deep.' }, { result: 'success' }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  assert.equal(asked.stdout, 'Under the palm.\n\nDig deep.\n');
  assert.match(idOf(asked.stderr), UUID);
  assert.equal(asked.stderr, `${idOf(asked.stderr)}\n`, 'nothing else on stderr');
});

test('ask prints the answer as it arrives, not when it is done', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const go = join(home, 'go');
  await claude.script([
    { say: 'First, the map.' },
    { waitFor: go },
    { say: 'Then the shovel.' },
    { result: 'success' },
  ]);

  const asking = firstmateRunning(t, home, ['ask', 'How?'], claude.env);
  const deadline = Date.now() + 15_000;
  while (!asking.output().includes('First, the map.')) {
    assert.ok(Date.now() < deadline, `the first part never came: ${asking.errors()}`);
    await new Promise((done) => setTimeout(done, 20));
  }

  assert.ok(!asking.output().includes('shovel'), 'the rest has not been written yet');
  await writeFile(go, '');
  assert.equal(await asking.ended, 0, asking.errors());
  assert.equal(asking.output(), 'First, the map.\n\nThen the shovel.\n');
});

test('ask reads the question from stdin when it is given no words', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);

  const asked = await firstmate(home, ['ask'], claude.env, 'Line one\nLine two\n');

  assert.equal(asked.code, 0, asked.stderr);
  assert.equal((await claude.calls())[0]?.stdin, 'Line one\nLine two');
});

test('ask with no question at all is refused, and runs nothing', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);

  const asked = await firstmate(home, ['ask'], claude.env, '  \n');

  assert.equal(asked.code, 2, asked.stderr);
  assert.match(asked.stderr, /ask needs a question/);
  assert.deepEqual(await claude.calls(), []);
  assert.equal(await stat(join(home, 'conversations')).catch(() => null), null);
});

test('ask keeps the Conversation: its head, the question and the answer', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ say: 'Under the palm.' }, { result: 'success' }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const id = idOf(asked.stderr);
  assert.deepEqual(await readdir(join(home, 'conversations')), [`${id}.jsonl`]);
  const [head, question, answer, ...more] = await conversation(home, id);
  const session = (await claude.calls())[0]?.argv[5];
  assert.deepEqual(more, []);
  assert.deepEqual(
    { ...head, when: undefined },
    {
      agent: 'claude',
      place: DEFAULT_PLACE,
      session,
      title: 'Where is the treasure?',
      when: undefined,
    },
  );
  assert.ok(!Number.isNaN(Date.parse(String(head?.['when']))), 'when it was made');
  assert.deepEqual(
    { ...question, when: undefined },
    { who: 'operator', text: 'Where is the treasure?', when: undefined },
  );
  assert.deepEqual(
    { ...answer, when: undefined },
    { who: 'agent', text: 'Under the palm.', when: undefined },
  );
});

test('a Conversation is written for this user alone', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows keeps no mode bits; the home directory there is the user’s own');
    return;
  }
  const home = await makeHome(t);
  const claude = await fakeClaude(t);

  const asked = await firstmate(home, ['ask', 'Who reads this?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const file = join(home, 'conversations', `${idOf(asked.stderr)}.jsonl`);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(home, 'conversations'))).mode & 0o777, 0o700);
});

test('the title is the first line of the question, cut to 60 characters', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const first = 'A very long first line about the treasure, the map and the parrot on the mast';

  const asked = await firstmate(home, ['ask'], claude.env, `${first}\nand a second line\n`);

  assert.equal(asked.code, 0, asked.stderr);
  const [head] = await conversation(home, idOf(asked.stderr));
  assert.equal(head?.['title'], first.slice(0, 60));
});

test('claude failing mid-answer keeps the part that came, marked failed', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ say: 'Under the' }, { die: 1, stderr: 'API Error: Connection error.' }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 1, 'the exit code of a failure');
  assert.equal(asked.stdout, 'Under the\n');
  const lines = asked.stderr.trimEnd().split('\n');
  assert.equal(lines.length, 2, `the ID, then one sentence: ${asked.stderr}`);
  assert.match(lines[1] ?? '', /^firstmate: .*Claude.*API Error: Connection error\.$/);
  const [, , answer] = await conversation(home, idOf(asked.stderr));
  assert.equal(answer?.['text'], 'Under the');
  assert.equal(answer?.['ended'], 'failed');
  assert.match(String(answer?.['why']), /API Error: Connection error\./);
});

test('ask with no claude on PATH says so in one sentence, and keeps nothing', async (t) => {
  const home = await makeHome(t);

  const asked = await firstmate(home, ['ask', 'Anyone there?'], {
    PATH: await pathWith(t, []),
  });

  assert.equal(asked.code, 4, asked.stderr);
  assert.equal(asked.stdout, '');
  assert.match(asked.stderr, /^firstmate: .*claude.*PATH.*\n$/);
  assert.equal(asked.stderr.trimEnd().split('\n').length, 1, 'one sentence');
  assert.equal(await stat(join(home, 'conversations')).catch(() => null), null);
});
