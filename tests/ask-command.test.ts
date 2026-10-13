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

test('a question cmd.exe would read its own way reaches claude unchanged, on stdin', async (t) => {
  // On Windows the fake is claude.cmd, which runs through cmd.exe (ADR-0019).
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const question = 'Is "%PATH%" & calc | more ^ <safe> !here!?';

  const asked = await firstmate(home, ['ask', question], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  assert.equal(asked.stdout, 'Ahoy.\n');
  const [call] = await claude.calls();
  assert.equal(call?.stdin, question);
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

  const path = await pathWith(t, []);

  const asked = await firstmate(home, ['ask', 'Anyone there?'], { PATH: path });

  assert.equal(asked.code, 4, asked.stderr);
  assert.equal(asked.stdout, '');
  assert.equal(
    asked.stderr,
    `firstmate: cannot find claude on the PATH of the ${DEFAULT_PLACE} Place, which is ${path}. ` +
      'Install Claude there, or set "program" in the Mate settings to where it is.\n',
  );
  assert.equal(await stat(join(home, 'conversations')).catch(() => null), null);
});

test('ask --conversation resumes its Claude session, and appends to the same Conversation', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ say: 'Under the palm.' }, { result: 'success' }]);
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);
  const id = idOf(first.stderr);
  const session = (await claude.calls())[0]?.argv[5];
  await claude.script([{ say: 'Three paces north.' }, { result: 'success' }]);

  const next = await firstmate(home, ['ask', '--conversation', id, 'How', 'far?'], claude.env);

  assert.equal(next.code, 0, next.stderr);
  assert.equal(next.stdout, 'Three paces north.\n');
  assert.equal(next.stderr, `${id}\n`, 'the same Conversation ID, and nothing else');
  const [, call] = await claude.calls();
  assert.deepEqual(call?.argv, [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--resume',
    session,
  ]);
  assert.equal(call?.stdin, 'How far?');
  assert.deepEqual(await readdir(join(home, 'conversations')), [`${id}.jsonl`]);
  const [head, , , question, answer, ...more] = await conversation(home, id);
  assert.deepEqual(more, []);
  assert.equal(head?.['session'], session);
  assert.deepEqual(
    [question?.['who'], question?.['text'], answer?.['who'], answer?.['text']],
    ['operator', 'How far?', 'agent', 'Three paces north.'],
  );
});

test('ask --conversation with an unknown ID is refused in one sentence, and writes nothing', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const unknown = '0f0e0d0c-0b0a-4908-8706-050403020100';

  for (const id of [unknown, '../registry']) {
    const asked = await firstmate(home, ['ask', '--conversation', id, 'Hello?'], claude.env);

    assert.equal(asked.code, 4, asked.stderr);
    assert.equal(asked.stdout, '');
    assert.equal(asked.stderr, `firstmate: there is no Conversation ${id}.\n`);
  }
  assert.deepEqual(await claude.calls(), []);
  assert.equal(await stat(join(home, 'conversations')).catch(() => null), null);
});

test('a Conversation with a line that cannot be read is refused, and the others go on', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const damaged = idOf((await firstmate(home, ['ask', 'First?'], claude.env)).stderr);
  const sound = idOf((await firstmate(home, ['ask', 'Second?'], claude.env)).stderr);
  const file = join(home, 'conversations', `${damaged}.jsonl`);
  await writeFile(file, `${await readFile(file, 'utf8')}{"who":"agent","text":\n`);
  const before = await readFile(file, 'utf8');

  const refused = await firstmate(home, ['ask', '--conversation', damaged, 'Again?'], claude.env);

  assert.equal(refused.code, 1, refused.stderr);
  assert.equal(refused.stdout, '');
  assert.equal(
    refused.stderr,
    `firstmate: Line 4 of the Conversation at ${file} cannot be read.\n`,
  );
  assert.equal(await readFile(file, 'utf8'), before, 'nothing written');
  assert.equal((await claude.calls()).length, 2, 'claude did not run for it');
  const other = await firstmate(home, ['ask', '--conversation', sound, 'Again?'], claude.env);
  assert.equal(other.code, 0, other.stderr);
});

test('a session claude cannot resume is refused in one sentence that says to start anew', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const id = idOf((await firstmate(home, ['ask', 'Where is the treasure?'], claude.env)).stderr);
  await claude.forget();

  const asked = await firstmate(home, ['ask', '--conversation', id, 'And now?'], claude.env);

  assert.equal(asked.code, 1, asked.stderr);
  assert.equal(asked.stdout, '');
  const [said, sentence, ...more] = asked.stderr.trimEnd().split('\n');
  assert.equal(said, id);
  assert.deepEqual(more, [], `one sentence: ${asked.stderr}`);
  assert.match(sentence ?? '', /^firstmate: Claude .*cannot resume.*start a new Conversation\.$/);
});

test('ask --conversation resumes in the Place its head names, not the default one', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const id = idOf((await firstmate(home, ['ask', 'Where is the treasure?'], claude.env)).stderr);
  const file = join(home, 'conversations', `${id}.jsonl`);
  const [head, ...rest] = (await readFile(file, 'utf8')).split('\n');
  const aboard = { ...(JSON.parse(head ?? '') as object), place: 'galley' };
  await writeFile(file, [JSON.stringify(aboard), ...rest].join('\n'));
  const before = await readFile(file, 'utf8');

  const gone = await firstmate(home, ['ask', '--conversation', id, 'Still there?'], claude.env);

  assert.equal(gone.code, 4, gone.stderr);
  assert.match(gone.stderr, /^firstmate: the galley Place of Conversation .* is gone\. .*\n$/);
  assert.equal(await readFile(file, 'utf8'), before, 'nothing written');
  assert.equal((await claude.calls()).length, 1, 'claude did not run for it');

  const added = await firstmate(home, ['place', 'add', 'galley', 'local'], claude.env);
  assert.equal(added.code, 0, added.stderr);
  const back = await firstmate(home, ['ask', '--conversation', id, 'Still there?'], claude.env);
  assert.equal(back.code, 0, back.stderr);
});

test('claude with no login is refused in one sentence that names the login command', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ loggedOut: true }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 1, asked.stderr);
  assert.equal(asked.stdout, '', 'what claude says about its login is not the answer');
  const [, sentence, ...more] = asked.stderr.trimEnd().split('\n');
  assert.deepEqual(more, [], `one sentence: ${asked.stderr}`);
  assert.equal(
    sentence,
    `firstmate: Claude in the ${DEFAULT_PLACE} Place is not logged in. ` +
      'Run claude auth login there, then ask again.',
  );
});
