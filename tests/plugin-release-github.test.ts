/**
 * How `install` and `update` read what GitHub says about a repository's
 * Plugin Releases: its secondary rate limit (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { serveGitHub } from './helpers/github.ts';
import { firstmate, makeHome } from './helpers/host.ts';

/** The releases path the command line asks first. */
const LIST = '/repos/someone/both/releases?per_page=100';

test('a 403 with retry-after, the secondary rate limit, is refused with that time', async (t) => {
  const github = await serveGitHub(t);
  github.answer(LIST, {
    status: 403,
    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4999' },
    body: '{"message":"You have exceeded a secondary rate limit."}',
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(installed.stderr, /Try again in 1 minute\./);
  assert.deepEqual(github.asked, [LIST], 'no clone');
});
