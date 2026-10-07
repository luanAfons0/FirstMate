/**
 * The `wsl` Place: one WSL distribution. Its Plugins keep their `mcp` file as
 * it is and run inside the distribution through `wsl.exe`; their files are
 * read through the Place's root, and their Plugin Pages are served like any
 * other (ADR-0021). The distribution here is a fake, and the root a folder.
 */
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHostIn, firstmate, fixture, makeHome, type Booted } from './helpers/host.ts';
import { fakeWsl, NO_FAKE_WSL, type Wsl } from './helpers/wsl.ts';

/** A Plugin fixture, put inside the fake distribution at this path. */
async function inDistribution(wsl: Wsl, plugin: string, path: string): Promise<void> {
  await mkdir(join(wsl.root, path), { recursive: true });
  await cp(fixture(plugin), join(wsl.root, path), { recursive: true });
}

async function stateOf(host: Booted, name: string): Promise<string | undefined> {
  const listed = (await (await host.fetch('/plugins.json')).json()) as {
    plugins: { name: string; state: string }[];
  };
  return listed.plugins.find((plugin) => plugin.name === name)?.state;
}

test(
  'a wsl Place keeps its distribution, its root and its home',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);

    const added = await firstmate(
      home,
      ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root],
      wsl.env,
    );
    const plain = await firstmate(home, ['place', 'add', 'deb-too', 'wsl', 'Debian'], wsl.env);

    assert.equal(added.code, 0, added.stderr);
    assert.equal(added.stdout, 'firstmate: added the wsl Place deb\n');
    assert.equal(plain.code, 0, plain.stderr);
    const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
    assert.deepEqual(settings.places, [
      { name: 'deb', kind: 'wsl', distribution: 'Debian', root: wsl.root, home: '/home/mate' },
      {
        name: 'deb-too',
        kind: 'wsl',
        distribution: 'Debian',
        root: '\\\\wsl.localhost\\Debian',
        home: '/home/mate',
      },
    ]);
    const listed = await firstmate(home, ['place', '--json']);
    const deb = JSON.parse(listed.stdout).places[1];
    assert.equal(deb.shelf, '/home/mate/.firstmate/shelf', 'the Shelf a 1.x Host kept there');
  },
);

test(
  'a distribution that does not answer is refused, and nothing is written',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);

    const refused = await firstmate(home, ['place', 'add', 'gone', 'wsl', 'Nope'], wsl.env);

    assert.equal(refused.code, 3);
    assert.equal(
      refused.stderr,
      'firstmate: the distribution Nope did not answer: ' +
        'There is no distribution with the supplied name.\n',
    );
    await assert.rejects(readFile(join(home, 'settings.json')), 'no Place was written');
  },
);

test(
  'a wsl Plugin starts through wsl.exe, and its Plugin Page is served',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await inDistribution(wsl, 'both', '/home/mate/plugins/both');
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    const added = await firstmate(home, [
      'add',
      'both',
      '/home/mate/plugins/both',
      '--place',
      'deb',
    ]);
    assert.equal(added.stdout, 'firstmate: added both at /home/mate/plugins/both, in deb\n');

    const host = await bootHostIn(t, home, wsl.env);

    assert.equal(await stateOf(host, 'both'), 'running', host.output());
    assert.ok(
      (await wsl.calls()).includes('wsl.exe -d Debian --cd /home/mate/plugins/both -- ./mcp'),
      (await wsl.calls()).join('\n'),
    );
    const page = await host.fetch('/p/both/');
    assert.equal(page.status, 200, 'the page is read through the root');
    assert.match(
      host.output(),
      /both: private\.txt says/,
      'and the Plugin Server runs in its own directory',
    );
  },
);

test(
  'a wsl Plugin whose files cannot be read is Stopped, and nothing retries it',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    const gone = join(wsl.root, 'not-there');
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({
        places: [
          { name: 'deb', kind: 'wsl', distribution: 'Debian', root: gone, home: '/home/mate' },
        ],
      }),
    );
    await writeFile(
      join(home, 'registry.json'),
      JSON.stringify({
        plugins: [{ name: 'both', place: 'deb', directory: '/home/mate/plugins/both', grants: [] }],
      }),
    );

    const host = await bootHostIn(t, home, wsl.env);

    assert.equal(await stateOf(host, 'both'), 'stopped');
    assert.ok(
      host
        .output()
        .includes(
          `the Plugin named both is Stopped: ${join(gone, 'home/mate/plugins/both')} cannot be read. ` +
            'Is the distribution Debian there, and does it start?',
        ),
      host.output(),
    );
    assert.deepEqual(await wsl.calls(), [], 'nothing was started, so nothing loops');
  },
);

test(
  'a wsl Plugin that ships only mcp.ts is Stopped, because a wsl Place starts mcp',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await inDistribution(wsl, 'node-form', '/home/mate/plugins/node-form');
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    await firstmate(home, ['add', 'node-form', '/home/mate/plugins/node-form', '--place', 'deb']);

    const host = await bootHostIn(t, home, wsl.env);

    assert.equal(await stateOf(host, 'node-form'), 'stopped');
    assert.ok(
      host
        .output()
        .includes(
          `the Plugin named node-form is Stopped: ` +
            `${join(wsl.root, 'home/mate/plugins/node-form', 'mcp.ts')} cannot run in a wsl Place, ` +
            'which starts mcp.',
        ),
      host.output(),
    );
    assert.ok(
      !(await wsl.calls()).some((call) => call.endsWith('./mcp')),
      'nothing was started in the distribution',
    );
  },
);

test('a Plugin whose Place is not there is Stopped, and says so', async (t) => {
  const home = await makeHome(t);
  await writeFile(
    join(home, 'registry.json'),
    JSON.stringify({
      plugins: [{ name: 'both', place: 'gone', directory: fixture('both'), grants: [] }],
    }),
  );

  const host = await bootHostIn(t, home);

  assert.equal(await stateOf(host, 'both'), 'stopped');
  assert.match(
    host.output(),
    /the Plugin named both is Stopped: its Place, gone, is not there\. Add it, or move the Plugin\./,
  );
});

test(
  'install fetches into the Shelf inside the distribution, and makes mcp executable',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);

    const installed = await firstmate(
      home,
      ['install', fixture('server-only'), '--place', 'deb'],
      wsl.env,
    );

    const inside = '/home/mate/.firstmate/shelf/server-only';
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(installed.stdout, `firstmate: installed server-only at ${inside}, in deb\n`);
    assert.ok((await stat(join(wsl.root, inside, 'mcp'))).isFile(), 'the files landed in the root');
    assert.ok(
      (await wsl.calls()).includes(`wsl.exe -d Debian --cd ${inside} --exec chmod +x mcp`),
      (await wsl.calls()).join('\n'),
    );
    const rows = JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')).plugins;
    assert.deepEqual(rows, [{ name: 'server-only', place: 'deb', directory: inside, grants: [] }]);
  },
);

test(
  'a Plugin on this machine calls a Plugin in a wsl Place under a Grant',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await inDistribution(wsl, 'server-only', '/home/mate/plugins/server-only');
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    await firstmate(home, [
      'add',
      'server-only',
      '/home/mate/plugins/server-only',
      '--place',
      'deb',
    ]);
    await firstmate(home, ['add', 'asker', fixture('caller')]);
    await firstmate(home, ['grant', 'asker', 'server-only']);
    const host = await bootHostIn(t, home, wsl.env);

    const answer = await host.fetch('/p/asker/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: host.origin,
        referer: `${host.origin}/p/asker/`,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'reach', arguments: { plugin: 'server-only', tool: 'ping' } },
      }),
    });

    const said = (await answer.json()) as { result?: { content?: { text: string }[] } };
    assert.equal(said.result?.content?.[0]?.text, 'pong from server-only');
  },
);
