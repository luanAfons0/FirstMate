/**
 * Codex as the Agent: with `agent: codex` in the Mate settings, firstmate ask
 * runs `codex exec`, read-only, with the question on standard input, and keeps
 * the thread Codex names as the Conversation's Agent session.
 *
 * The Agent is a fake `codex` on PATH, which writes what the real one writes.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeCodex } from './helpers/agents.ts';
import { DEFAULT_PLACE, firstmate, firstmateRunning, makeHome } from './helpers/host.ts';

/** The ID a UUID has, as a Codex thread and a Conversation are named. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Write these settings, whole, as an operator or the App would. */
async function settle(home: string, settings: unknown): Promise<void> {
  await writeFile(join(home, 'settings.json'), `${JSON.stringify(settings)}\n`);
}

/** The Conversation ID ask said on stderr: its first line. */
function idOf(stderr: string): string {
  return stderr.split('\n')[0] ?? '';
}

/** Every line of one Conversation file, read as JSON. */
async function conversation(home: string, id: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(home, 'conversations', `${id}.jsonl`), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('ask runs codex exec read-only, and sends the question on stdin alone', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex' } });

  const asked = await firstmate(home, ['ask', 'Where', 'is', 'the', 'treasure?'], codex.env);

  assert.equal(asked.code, 0, asked.stderr);
  const [call, ...more] = await codex.calls();
  assert.equal(more.length, 0, 'codex ran once');
  assert.ok(call !== undefined);
  assert.deepEqual(call.argv, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
  ]);
  assert.equal(call.stdin, 'Where is the treasure?');
  assert.equal(call.cwd, codex.home, "in the operator's home directory");
});

test("ask prints Codex's answer as it arrives, and keeps the thread Codex names", async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex' } });
  const go = join(home, 'go');
  await codex.script([
    { say: 'First, the map.' },
    { waitFor: go },
    { say: 'Then the shovel.' },
    { result: 'success' },
  ]);

  const asking = firstmateRunning(t, home, ['ask', 'How?'], codex.env);
  const deadline = Date.now() + 15_000;
  while (!asking.output().includes('First, the map.')) {
    assert.ok(Date.now() < deadline, `the first part never came: ${asking.errors()}`);
    await new Promise((done) => setTimeout(done, 20));
  }

  assert.ok(!asking.output().includes('shovel'), 'the rest has not been written yet');
  await writeFile(go, '');
  assert.equal(await asking.ended, 0, asking.errors());
  assert.equal(asking.output(), 'First, the map.\n\nThen the shovel.\n');
  const [head, , answer] = await conversation(home, idOf(asking.errors()));
  assert.equal(head?.['agent'], 'codex');
  assert.match(String(head?.['session']), UUID, 'the thread of thread.started');
  assert.equal(answer?.['text'], 'First, the map.\n\nThen the shovel.');
});

test('ask --conversation resumes its Codex thread, even after the settings name Claude', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex' } });
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], codex.env);
  assert.equal(first.code, 0, first.stderr);
  const id = idOf(first.stderr);
  const [head] = await conversation(home, id);
  await settle(home, { mate: { agent: 'claude' } });
  await codex.script([{ say: 'Three paces north.' }, { result: 'success' }]);

  const next = await firstmate(home, ['ask', '--conversation', id, 'How', 'far?'], codex.env);

  assert.equal(next.code, 0, next.stderr);
  assert.equal(next.stdout, 'Three paces north.\n');
  const [, call] = await codex.calls();
  assert.deepEqual(call?.argv, [
    'exec',
    'resume',
    '--json',
    '--skip-git-repo-check',
    '-c',
    'sandbox_mode=read-only',
    '--',
    head?.['session'],
  ]);
  assert.equal(call?.stdin, 'How far?');
  const [, , , question, answer, ...more] = await conversation(home, id);
  assert.deepEqual(more, []);
  assert.deepEqual([question?.['text'], answer?.['text']], ['How far?', 'Three paces north.']);
});

test('the model and the effort of the Mate settings reach codex, and its resume', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex', model: 'gpt-5.5', effort: 'xhigh' } });
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], codex.env);
  assert.equal(first.code, 0, first.stderr);
  await settle(home, { mate: { agent: 'codex', model: 'o3', effort: 'low' } });
  const id = idOf(first.stderr);

  const next = await firstmate(home, ['ask', '--conversation', id, 'Far?'], codex.env);

  assert.equal(next.code, 0, next.stderr);
  const [started, resumed] = await codex.calls();
  const tuning = ['-m', 'gpt-5.5', '-c', 'model_reasoning_effort=xhigh'];
  assert.deepEqual(started?.argv.slice(5), tuning);
  assert.deepEqual(resumed?.argv.slice(6, -2), tuning);
});

test('a thread codex cannot resume is refused in one sentence that says to start anew', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex' } });
  const id = idOf((await firstmate(home, ['ask', 'Where is the treasure?'], codex.env)).stderr);
  await codex.forget();

  const asked = await firstmate(home, ['ask', '--conversation', id, 'And now?'], codex.env);

  assert.equal(asked.code, 1, asked.stderr);
  assert.equal(asked.stdout, '');
  const [said, sentence, ...more] = asked.stderr.trimEnd().split('\n');
  assert.equal(said, id);
  assert.deepEqual(more, [], `one sentence: ${asked.stderr}`);
  assert.match(sentence ?? '', /^firstmate: Codex .*cannot resume.*start a new Conversation\.$/);
});

test('a Codex turn that fails keeps the part that came, and says why in one sentence', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex', model: 'parrot-1' } });
  const refused = "The 'parrot-1' model is not supported when using Codex with a ChatGPT account.";
  await codex.script([{ say: 'Under the' }, { fail: refused }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], codex.env);

  assert.equal(asked.code, 1, 'the exit code of a failure');
  assert.equal(asked.stdout, 'Under the\n');
  const lines = asked.stderr.trimEnd().split('\n');
  assert.equal(lines.length, 2, `the ID, then one sentence: ${asked.stderr}`);
  assert.equal(lines[1], `firstmate: Codex stopped before its answer was done: ${refused}`);
  const [head, , answer] = await conversation(home, idOf(asked.stderr));
  assert.match(String(head?.['session']), UUID, 'the thread is kept, to resume');
  assert.deepEqual([answer?.['text'], answer?.['ended']], ['Under the', 'failed']);
});

test('codex with no login is refused in one sentence that names the login command', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await settle(home, { mate: { agent: 'codex' } });
  await codex.script([{ loggedOut: true }]);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], codex.env);

  assert.equal(asked.code, 1, asked.stderr);
  assert.equal(asked.stdout, '');
  const [, sentence, ...more] = asked.stderr.trimEnd().split('\n');
  assert.deepEqual(more, [], `one sentence: ${asked.stderr}`);
  assert.equal(
    sentence,
    `firstmate: Codex in the ${DEFAULT_PLACE} Place is not logged in. ` +
      'Run codex login there, then ask again.',
  );
});
