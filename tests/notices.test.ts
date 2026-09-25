/**
 * A Plugin Server sends a Notice on its own pipe, the Host holds it for a short
 * time, and the Tray reads it at /notices.json (ADR-0014). A bad Notice is
 * refused with a sentence, and a Plugin that goes Stopped gets a Notice from
 * the Host itself.
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { bootHost, type Booted } from './helpers/host.ts';

type Notice = { sequence: number; title: string; body: string; address: string };
type Listed = { latest: number; notices: Notice[] };

const NOTIFIER = [{ name: 'notifier', directory: 'notifier' }];

/** The environment that makes the `notifier` fixture send these steps. */
function sends(...steps: readonly unknown[]): Record<string, string> {
  return { NOTIFIER_SENDS: JSON.stringify(steps) };
}

async function noticesOf(host: Booted, after?: number): Promise<Listed> {
  const answer = await host.fetch(`/notices.json${after === undefined ? '' : `?after=${after}`}`);
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type') ?? '', /^application\/json/);
  return (await answer.json()) as Listed;
}

/**
 * Wait for a line in the Host's output. A Plugin Server's stderr arrives when
 * the Plugin Server writes it, which is not when the Host answered a request.
 */
async function until(host: Booted, pattern: RegExp): Promise<RegExpExecArray> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = pattern.exec(host.output());
    if (found !== null) return found;
    assert.ok(Date.now() < deadline, `the Host never said ${pattern}\n${host.output()}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** Every answer the `notifier` fixture was given, in the order it sent them. */
async function answersOf(host: Booted, count: number): Promise<string[]> {
  await until(host, /notifier: sent every notice/);
  const answers = [...host.output().matchAll(/notifier: notice \d+ answered id \d+: (.+)/g)];
  assert.equal(answers.length, count, host.output());
  return answers.map((answer) => answer[1] ?? '');
}

async function filesUnder(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true })).sort();
}

test('a Plugin Server sends a Notice and is answered with its own id', async (t) => {
  const host = await bootHost(t, NOTIFIER);

  const said = await until(host, /notifier: notice (\d+) answered id (\d+): (.+)/);

  assert.equal(said[2], said[1], 'the answer carries the id the Plugin Server gave');
  assert.equal(said[3], 'accepted');
});

test('the Notice is listed under the sender\'s name, with the address a click opens', async (t) => {
  const host = await bootHost(t, NOTIFIER);
  await until(host, /notifier: sent every notice/);

  assert.deepEqual(await noticesOf(host), {
    latest: 1,
    notices: [
      {
        sequence: 1,
        title: 'notifier: Build done',
        body: 'All 12 steps passed.',
        address: '/p/notifier/runs/7.html',
      },
    ],
  });
});

test('a Notice with no path opens the root of the Plugin Page', async (t) => {
  const host = await bootHost(t, NOTIFIER, sends({ title: 'Hello', body: '' }));
  await until(host, /notifier: sent every notice/);

  const [notice] = (await noticesOf(host)).notices;

  assert.equal(notice?.address, '/p/notifier/');
  assert.equal(notice?.body, '', 'an empty body is a body');
});

test('the Tray asks for what came after its cursor, and gets it in order', async (t) => {
  const plugins = ['one', 'two', 'three'].map((name) => ({ name, directory: 'notifier' }));
  const host = await bootHost(t, plugins);
  await until(host, /(notifier: sent every notice[^]*){3}/);

  const all = await noticesOf(host);
  assert.equal(all.latest, 3);
  assert.deepEqual(
    all.notices.map((notice) => notice.sequence),
    [1, 2, 3],
  );

  const newer = await noticesOf(host, 1);
  assert.equal(newer.latest, 3, 'the latest number moves the cursor');
  assert.deepEqual(newer.notices, all.notices.slice(1));

  assert.deepEqual(await noticesOf(host, 3), { latest: 3, notices: [] });
});

test('the Host holds the last 20 Notices, and the oldest go first', async (t) => {
  // One Notice every 5 s per Plugin, so 22 Plugins make 22 Notices at once.
  const plugins = Array.from({ length: 22 }, (_, at) => ({
    name: `notifier-${at + 1}`,
    directory: 'notifier',
  }));
  const host = await bootHost(t, plugins);
  await until(host, /(notifier: sent every notice[^]*){22}/);

  const listed = await noticesOf(host);

  assert.equal(listed.latest, 22);
  assert.deepEqual(
    listed.notices.map((notice) => notice.sequence),
    Array.from({ length: 20 }, (_, at) => at + 3),
  );
});

test('a Notice is gone once FIRSTMATE_NOTICE_MS has passed', async (t) => {
  const host = await bootHost(t, NOTIFIER, { FIRSTMATE_NOTICE_MS: '1500' });
  await until(host, /notifier: sent every notice/);
  assert.equal((await noticesOf(host)).notices.length, 1, 'it is there at first');

  await new Promise((done) => setTimeout(done, 1600));

  assert.deepEqual(await noticesOf(host), { latest: 1, notices: [] });
});

test('the Notices are refused with no token or from a foreign Origin', async (t) => {
  const host = await bootHost(t, NOTIFIER);
  await until(host, /notifier: sent every notice/);

  const stranger = await host.raw({ path: '/notices.json', anonymous: true });
  assert.equal(stranger.status, 403);
  assert.match(stranger.body, /no token/);

  const foreign = await host.raw({
    path: '/notices.json',
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403);
  assert.match(foreign.body, /Origin/);

  for (const answer of [stranger, foreign]) {
    assert.ok(!answer.body.includes('Build done'), 'nothing of a Notice leaks');
  }

  const tray = await host.raw({ path: `/notices.json?token=${host.token}`, anonymous: true });
  assert.equal(tray.status, 200, 'the Tray reads them with the token alone');
  assert.ok(tray.body.includes('Build done'), tray.body);
});

test('no address on the Host takes a Notice', async (t) => {
  const host = await bootHost(t, NOTIFIER);
  await until(host, /notifier: sent every notice/);
  const body = JSON.stringify({ title: 'From a page', body: '' });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const listed = await host.fetch('/notices.json', { method, body });
    assert.equal(listed.status, 405, `${method} /notices.json`);
    assert.equal(listed.headers.get('allow'), 'GET, HEAD');
  }

  assert.equal((await noticesOf(host)).latest, 1, 'no request added a Notice');
});

test('a cursor that is not a whole number is refused with a sentence', async (t) => {
  const host = await bootHost(t, NOTIFIER);

  for (const after of ['-1', 'one', '1.5']) {
    const answer = await host.fetch(`/notices.json?after=${after}`);
    assert.equal(answer.status, 400, after);
    assert.match(await answer.text(), /"after" .* whole number/);
  }
});

test('a Notice leaves nothing in the home directory', async (t) => {
  const host = await bootHost(t, [...NOTIFIER, { name: 'quitter', directory: 'quitter' }]);
  await until(host, /notifier: sent every notice/);
  assert.equal((await noticesOf(host)).latest, 2, 'a Plugin Notice and a Host Notice');

  // What the Host writes for any run, and nothing for a Notice (ADR-0005).
  assert.deepEqual(await filesUnder(host.home), ['registry.json', 'runtime.json']);
});

test('each bad Notice is refused with a sentence, and never listed', async (t) => {
  const long = (length: number): string => 'x'.repeat(length);
  const host = await bootHost(
    t,
    NOTIFIER,
    sends(
      { title: long(65), body: '' },
      { title: 'Fine', body: long(201) },
      { title: 'Fine', body: '', path: '../other/' },
      { title: 'Fine', body: '', path: '/p/other/' },
      { title: 'Fine', body: '', path: 'https://evil.example/' },
      { body: 'no title' },
      { title: '', body: '' },
      { title: 7, body: '' },
      { title: 'Fine' },
      { title: 'Fine', body: ['not', 'a', 'string'] },
      { title: 'Fine', body: '', path: 7 },
      null,
    ),
  );

  const answers = await answersOf(host, 12);

  assert.deepEqual(answers, [
    'The "title" of a Notice may be 64 characters long, and this one is 65.',
    'The "body" of a Notice may be 200 characters long, and this one is 201.',
    'The "path" "../other/" leaves the address of notifier, /p/notifier/.',
    'The "path" "/p/other/" leaves the address of notifier, /p/notifier/.',
    'The "path" "https://evil.example/" leaves the address of notifier, /p/notifier/.',
    'A firstmate/notice needs a "title": a string of 1 to 64 characters.',
    'A firstmate/notice needs a "title": a string of 1 to 64 characters.',
    'A firstmate/notice needs a "title": a string of 1 to 64 characters.',
    'A firstmate/notice needs a "body": a string of at most 200 characters.',
    'A firstmate/notice needs a "body": a string of at most 200 characters.',
    'The "path" of a Notice must be a string, not 7.',
    'A firstmate/notice needs a "title": a string of 1 to 64 characters.',
  ]);
  assert.deepEqual(await noticesOf(host), { latest: 0, notices: [] });
});

test('a title and a body at the limit are accepted whole', async (t) => {
  const host = await bootHost(
    t,
    NOTIFIER,
    sends({ title: 't'.repeat(64), body: 'b'.repeat(200) }),
  );

  assert.deepEqual(await answersOf(host, 1), ['accepted']);
  const [notice] = (await noticesOf(host)).notices;
  assert.equal(notice?.title, `notifier: ${'t'.repeat(64)}`, 'never cut short');
  assert.equal(notice?.body.length, 200);
});

test('a Plugin may send one Notice every 5 s', async (t) => {
  const host = await bootHost(
    t,
    [...NOTIFIER, { name: 'other', directory: 'notifier' }],
    sends(
      { title: 'First', body: '' },
      { title: 'Too soon', body: '' },
      { waitMs: 5_000 },
      { title: 'Later', body: '' },
    ),
  );

  await until(host, /(notifier: sent every notice[^]*){2}/);
  const answers = [...host.output().matchAll(/notifier: notice \d+ answered id \d+: (.+)/g)].map(
    (answer) => answer[1] ?? '',
  );

  // Two Plugins, each: accepted, too soon, accepted. One's gap never holds
  // back the other's.
  assert.equal(answers.filter((answer) => answer === 'accepted').length, 4, host.output());
  const refused = answers.filter((answer) => answer !== 'accepted');
  assert.equal(refused.length, 2, host.output());
  for (const answer of refused) {
    assert.match(answer, /^A Plugin may send one Notice every 5 s\. The last one from \S+ was/);
  }

  const titles = (await noticesOf(host)).notices.map((notice) => notice.title).sort();
  assert.deepEqual(titles, [
    'notifier: First',
    'notifier: Later',
    'other: First',
    'other: Later',
  ]);
});

test('a Plugin that goes Stopped gets a Notice from the Host', async (t) => {
  const host = await bootHost(t, [{ name: 'quitter', directory: 'quitter' }]);

  const [notice] = (await noticesOf(host)).notices;

  assert.equal(notice?.title, 'FirstMate: quitter is Stopped');
  assert.equal(notice?.body, 'exit 3.', 'the body says why');
  assert.equal(notice?.address, '/', 'a click opens the Index Page');
});

test('an mcp that cannot be run says why in its Stopped Notice', async (t) => {
  const host = await bootHost(t, [{ name: 'unrunnable', directory: 'unrunnable' }]);

  const [notice] = (await noticesOf(host)).notices;

  assert.equal(notice?.title, 'FirstMate: unrunnable is Stopped');
  assert.match(notice?.body ?? '', /is not executable\.$/);
});

test('a Plugin that stays Running adds no Host Notice', async (t) => {
  const host = await bootHost(t, [
    { name: 'both', directory: 'both' },
    { name: 'server-only', directory: 'server-only' },
    { name: 'page-only', directory: 'page-only' },
  ]);
  await host.fetch('/');

  assert.deepEqual(await noticesOf(host), { latest: 0, notices: [] });
});

test('a Plugin cannot speak as the Host: its own name always comes first', async (t) => {
  const host = await bootHost(
    t,
    NOTIFIER,
    sends({ title: 'FirstMate: quitter is Stopped', body: 'exit 3.' }),
  );
  await until(host, /notifier: sent every notice/);

  const [notice] = (await noticesOf(host)).notices;

  assert.equal(notice?.title, 'notifier: FirstMate: quitter is Stopped');
  assert.equal(notice?.address, '/p/notifier/', 'and a click opens its own address');
});
