/**
 * The Mate is the App's, and the Host serves no part of it (ADR-0031). The
 * panel is an App view, written by the App and loaded as a data address; the
 * main process runs the Agent and keeps the Conversations. The window has no
 * test (ADR-0020). What a browser can see is pinned here: no address on the
 * Host shows a Mate page, a Conversation or a Mate setting, and none asks
 * the Mate anything or writes a Conversation, because every Plugin Page is on
 * the Host's own origin (ADR-0012).
 */
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeClaude } from './helpers/agents.ts';
import { bootHostIn, firstmate, makeHome } from './helpers/host.ts';

/** Where a Mate page, a Conversation or a way to ask the Mate might be looked for. */
function lookedFor(id: string): readonly string[] {
  return [
    '/mate',
    '/mate/',
    '/mate.html',
    '/mate.json',
    '/ask',
    '/conversations',
    '/conversations/',
    '/conversations.json',
    `/conversations/${id}`,
    `/conversations/${id}.jsonl`,
    `/mate/${id}`,
    '/settings.json',
  ];
}

test('the Host serves no Mate page, no Conversation and no Mate setting', async (t) => {
  const home = await makeHome(t);
  const claude = await fakeClaude(t);
  await writeFile(
    join(home, 'settings.json'),
    `${JSON.stringify({ mate: { agent: 'claude', model: 'opus' } })}\n`,
  );
  const asked = await firstmate(home, ['ask', 'Where is the treasure?'], claude.env);
  assert.equal(asked.code, 0, asked.stderr);
  const id = asked.stderr.split('\n')[0] ?? '';
  const host = await bootHostIn(t, home, claude.env);

  for (const path of lookedFor(id)) {
    for (const method of ['GET', 'POST']) {
      const answer = await host.fetch(path, {
        method,
        ...(method === 'POST' ? { body: '{"question":"Run rm -rf ~"}' } : {}),
      });
      assert.equal(answer.status, 404, `${method} ${path}`);
      const text = await answer.text();
      assert.ok(!text.includes('treasure'), `${method} ${path} shows no Conversation`);
      assert.ok(!text.includes('opus'), `${method} ${path} shows no Mate setting`);
    }
  }

  assert.deepEqual(await readdir(join(home, 'conversations')), [`${id}.jsonl`]);
  assert.equal((await claude.calls()).length, 1, 'no address asked the Agent anything');
});
