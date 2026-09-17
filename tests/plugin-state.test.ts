/**
 * Every registered Plugin that ships a Plugin Server is running as soon as the
 * Host is, and the Index Page tells the truth about each one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHost } from './helpers/host.ts';

const EVERY_FIXTURE = [
  { name: 'both', directory: 'both' },
  { name: 'page-only', directory: 'page-only' },
  { name: 'server-only', directory: 'server-only' },
  { name: 'quitter', directory: 'quitter' },
  { name: 'unrunnable', directory: 'unrunnable' },
];

/** The one word the Index Page says about a Plugin, read back off the page. */
function stateOf(page: string, name: string): string {
  // The row, not its markup: find the list item that names the Plugin, then
  // read the state out of it. How the Index Page dresses a row is its own.
  const row = page.split('</li>').find((chunk) => chunk.includes(`>${name}<`));
  assert.ok(row !== undefined, `the Index Page has a row for ${name}`);
  const state = /class="state [^"]*">([^<]+)</.exec(row);
  assert.ok(state !== null, `the row for ${name} says one state`);
  return state[1] ?? '';
}

test('the Index Page shows each Plugin as Running, Stopped, or shipping no Plugin Server', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const page = await (await host.fetch('/')).text();

  assert.equal(stateOf(page, 'both'), 'Running', 'an executable mcp is started');
  assert.equal(stateOf(page, 'server-only'), 'Running', 'a Plugin needs no page to run');
  assert.equal(stateOf(page, 'page-only'), 'no Plugin Server', 'a page alone is a Plugin too');
  assert.equal(stateOf(page, 'quitter'), 'Stopped', 'a Plugin Server that exits leaves it Stopped');
  assert.equal(stateOf(page, 'unrunnable'), 'Stopped', 'an mcp that cannot be run is Stopped');
});

test('Plugin Server output reaches the Host\'s own output', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);
  await host.fetch('/');

  const output = host.output();

  assert.match(output, /both: the Plugin Server is up/, 'a Python Plugin Server is heard');
  assert.match(output, /server-only: the Plugin Server is up/, 'so is a JavaScript one');
  assert.match(output, /quitter: the Plugin Server gave up/, 'so are its last words');
  assert.match(output, /the Plugin named quitter is Stopped/, 'and the Host says what it saw');
});

test('a Plugin Server that exits is never started again', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await (await host.fetch('/')).text();
    assert.equal(stateOf(page, 'quitter'), 'Stopped');
  }

  const starts = host.output().match(/quitter: the Plugin Server gave up/g) ?? [];
  assert.equal(starts.length, 1, 'it was started once and left alone');
});

test('a Stopped Plugin still serves its Plugin Page', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const answer = await host.fetch('/p/unrunnable/');

  assert.equal(answer.status, 200);
  assert.match(await answer.text(), /a Stopped Plugin still serves its Plugin Page/);
});

test('one Stopped Plugin leaves every other Plugin serving', async (t) => {
  const host = await bootHost(t, EVERY_FIXTURE);

  const index = await host.fetch('/');
  const page = await host.fetch('/p/both/');
  const asset = await host.fetch('/p/both/app.js');

  assert.equal(index.status, 200, 'the Host is up');
  assert.equal(page.status, 200, 'a healthy Plugin Page is untouched');
  assert.equal(asset.status, 200, 'and so are its assets');
});
