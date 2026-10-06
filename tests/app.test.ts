/**
 * The App holds the Host.
 *
 * The App is the program a person installs on Windows (ADR-0020). This test
 * packages it as a release does, starts the packaged program with a home and
 * a port of its own, and drives the Host inside it through the same helper as
 * every other test. The window has no test, as ADR-0011 chose and ADR-0020
 * keeps: this proves only that the App holds a working Host.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { bootHost, packageApp, type Booted } from './helpers/host.ts';

const skip = process.platform === 'win32' ? false : 'the App runs on Windows only (ADR-0020)';

/** One tool call, as a Plugin Page makes it: from its own page, same-origin. */
function ask(host: Booted, name: string, call: unknown): Promise<Response> {
  return host.fetch(`/p/${name}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: host.origin,
      referer: `${host.origin}/p/${name}/`,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify(call),
  });
}

test(
  'the packaged App holds a Host, and a second start holds no second one',
  { skip },
  async (t) => {
    const out = await packageApp(t);
    const installers = (await readdir(out)).filter((name) =>
      /^FirstMate-Setup-.+\.exe$/.test(name),
    );
    assert.equal(installers.length, 1, 'packaging makes one installer');

    const app = join(out, 'win-unpacked', 'FirstMate.exe');
    const host = await bootHost(
      t,
      [
        { name: 'server-only', directory: 'server-only' },
        { name: 'page-only', directory: 'page-only' },
      ],
      {},
      { app },
    );

    const index = await host.fetch('/');
    assert.equal(index.status, 200);
    assert.ok((await index.text()).includes('/p/page-only/'), 'the Index Page links the page');

    const listed = await host.fetch('/plugins.json');
    assert.deepEqual(await listed.json(), {
      plugins: [
        { name: 'server-only', hasPage: false, state: 'running' },
        { name: 'page-only', hasPage: true, state: 'no-plugin-server' },
      ],
    });

    // server-only's mcp.cmd runs on FIRSTMATE_NODE, which is the App itself:
    // an answer proves the App runs as Node for a Plugin Server.
    const answer = await ask(host, 'server-only', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    });
    const said = (await answer.json()) as { result: { content: { text: string }[] } };
    assert.equal(answer.status, 200);
    assert.equal(said.result.content[0]?.text, 'pong from server-only');

    const runtime = await readFile(join(host.home, 'runtime.json'), 'utf8');
    const second = spawn(app, [], {
      env: { ...process.env, FIRSTMATE_HOME: host.home, FIRSTMATE_PORT: '0' },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((done) => second.once('exit', done));
    assert.equal(code, 0, 'a second start ends at once, and calmly');
    assert.equal(
      await readFile(join(host.home, 'runtime.json'), 'utf8'),
      runtime,
      'the first Host is still the one the runtime file names',
    );
    assert.equal((await host.fetch('/plugins.json')).status, 200, 'and it still answers');
  },
);
