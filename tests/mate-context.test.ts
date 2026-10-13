/**
 * The Mate's context: what a new Conversation sends the Agent before the
 * operator's first question. It is a short primer about FirstMate, every
 * Plugin of the Registry, and the operator's own `mate.md`, all on standard
 * input, so it reaches every Agent in every Place the same way. A resumed
 * Conversation sends the question alone: the Agent's session holds the rest.
 *
 * The Agent is a fake `claude` or `codex` on PATH, which writes down what it
 * read on standard input.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { CONTEXT_ENDS as ENDS, fakeClaude, fakeCodex } from './helpers/agents.ts';
import { DEFAULT_PLACE, firstmate, fixture, makeHome } from './helpers/host.ts';

/** The first line of the context, which tells the Agent where it begins. */
const OPENS = '<firstmate-context>\n';

/** What a new Conversation sent the Agent, in the one call this home made. */
async function sent(calls: () => Promise<readonly { readonly stdin: string }[]>): Promise<string> {
  const [call, ...more] = await calls();
  assert.deepEqual(more, [], 'the Agent ran once');
  return call?.stdin ?? '';
}

/** The ID ask said on stderr: its first line. */
function idOf(stderr: string): string {
  return stderr.split('\n')[0] ?? '';
}

test('a new Conversation sends the primer, the Plugins and mate.md, then the question', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  assert.equal((await firstmate(home, ['add', 'both', fixture('both')])).code, 0);
  assert.equal((await firstmate(home, ['add', 'page-only', fixture('page-only')])).code, 0);
  await writeFile(join(home, 'mate.md'), 'I keep my maps in the worklog Plugin.\n');

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const stdin = await sent(claude.calls);
  assert.ok(stdin.startsWith(OPENS), stdin);
  assert.ok(stdin.endsWith(`${ENDS}Where is the treasure?`), stdin);
  assert.match(stdin, /FirstMate is a local plugin host/);
  for (const word of ['App', 'Host', 'Plugin Page', 'Plugin Server', 'Place', 'Registry']) {
    assert.match(stdin, new RegExp(`^- ${word}: `, 'm'), `the primer says what ${word} is`);
  }
  for (const command of ['list', 'status', 'logs', 'order', 'place', 'help']) {
    assert.match(stdin, new RegExp(`^- firstmate ${command}\\b`, 'm'), `it names ${command}`);
  }
  assert.ok(
    stdin.includes(
      `- both: Place ${DEFAULT_PLACE}, directory ${fixture('both')}, address /p/both/\n` +
        `- page-only: Place ${DEFAULT_PLACE}, directory ${fixture('page-only')}, ` +
        'address /p/page-only/\n',
    ),
    stdin,
  );
  assert.ok(stdin.includes('I keep my maps in the worklog Plugin.\n'), stdin);
  assert.ok(stdin.indexOf('worklog') < stdin.indexOf(ENDS), 'mate.md is inside the context');
});

test('a resumed Conversation sends the question alone', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await writeFile(join(home, 'mate.md'), 'I keep my maps in the worklog Plugin.\n');
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);
  assert.equal(first.code, 0, first.stderr);

  const id = idOf(first.stderr);
  const next = await firstmate(home, ['ask', '--conversation', id, 'How far?'], claude.env);

  assert.equal(next.code, 0, next.stderr);
  const [, call] = await claude.calls();
  assert.equal(call?.argv[4], '--resume');
  assert.equal(call?.stdin, 'How far?');
});

test('with no mate.md and no Plugin, the context says so and the question follows', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const stdin = await sent(claude.calls);
  assert.ok(stdin.startsWith(OPENS), stdin);
  assert.ok(stdin.endsWith(`${ENDS}Where is the treasure?`), stdin);
  assert.match(stdin, /^No Plugin is in the Registry yet\.$/m);
  assert.doesNotMatch(stdin, /mate\.md:/);
});

test('the Conversation keeps the question alone, as its title and its first message', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  assert.equal((await firstmate(home, ['add', 'both', fixture('both')])).code, 0);
  await writeFile(join(home, 'mate.md'), 'I keep my maps in the worklog Plugin.\n');

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const kept = await readFile(join(home, 'conversations', `${idOf(asked.stderr)}.jsonl`), 'utf8');
  const [head, question] = kept
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(head?.['title'], 'Where is the treasure?');
  assert.deepEqual([question?.['who'], question?.['text']], ['operator', 'Where is the treasure?']);
  assert.doesNotMatch(kept, /firstmate-context|worklog|\/p\/both\//);
});

test('codex hears the same context, on its standard input', async (t) => {
  const home = await makeHome(t);
  const codex = await fakeCodex(t);
  await writeFile(join(home, 'settings.json'), `${JSON.stringify({ mate: { agent: 'codex' } })}\n`);
  assert.equal((await firstmate(home, ['add', 'both', fixture('both')])).code, 0);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], codex.env);

  assert.equal(asked.code, 0, asked.stderr);
  const stdin = await sent(codex.calls);
  assert.ok(stdin.startsWith(OPENS), stdin);
  assert.ok(stdin.endsWith(`${ENDS}Where is the treasure?`), stdin);
  assert.ok(stdin.includes('address /p/both/'), stdin);
});

test('a Conversation whose first answer never began sends the context again', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await claude.script([{ die: 1, stderr: 'API Error: Connection error.' }]);
  const first = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);
  assert.equal(first.code, 1, first.stderr);
  // The Agent kept no session of a run that never answered.
  await claude.forget();
  await claude.script([{ say: 'Under the palm.' }, { result: 'success' }]);

  const id = idOf(first.stderr);
  const next = await firstmate(home, ['ask', '--conversation', id, 'Where?'], claude.env);

  assert.equal(next.code, 0, next.stderr);
  const [, call] = await claude.calls();
  assert.equal(call?.argv[4], '--session-id', 'a new session, which holds no context yet');
  assert.ok(call?.stdin.startsWith(OPENS), call?.stdin);
  assert.ok(call?.stdin.endsWith(`${ENDS}Where?`), call?.stdin);
});

test("the Host's token in mate.md never reaches the Agent", async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  const token = 'f3a9c2e1d0b8a7f6e5d4c3b2a1908f7e';
  await writeFile(join(home, 'runtime.json'), `${JSON.stringify({ port: 4747, token })}\n`);
  await writeFile(join(home, 'mate.md'), `My token is ${token}.\n`);

  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);

  assert.equal(asked.code, 0, asked.stderr);
  const stdin = await sent(claude.calls);
  assert.ok(!stdin.includes(token), stdin);
  assert.ok(stdin.includes("My token is [the Host's token]."), stdin);
});
