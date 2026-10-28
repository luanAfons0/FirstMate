/**
 * Installing a Plugin Release: `install` of a GitHub URL, or of an Official
 * Plugin's name, fetches the newest Plugin Release, checks it against its
 * `.sha256`, and lands its files in the Shelf (ADR-0033).
 *
 * It needs no network: GitHub is the fake in `helpers/github.ts`, and every
 * Plugin Release is made by the archive script the release workflow runs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import {
  DEFAULT_PLACE,
  bootHostIn,
  canStart,
  firstmate,
  fixture,
  makeHome,
} from './helpers/host.ts';

type Registry = {
  plugins: {
    name: string;
    place: string;
    directory: string;
    grants: string[];
    release?: { repository: string; version: string };
  }[];
};

async function registry(home: string): Promise<Registry> {
  return JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')) as Registry;
}

/** The SHA-256 of a fixture's file, as `sha256sum` says it. */
async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

test('a GitHub URL with a Plugin Release lands that release, registered, and served', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both.git'],
    github.env,
  );

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'both');
  assert.ok(
    installed.stdout.includes(`installed both at ${landed}, Release Version 1.2.0`),
    installed.stdout,
  );
  assert.ok(await canStart(landed), 'mcp is still executable');
  assert.equal(
    await readFile(join(landed, 'web', 'nested', 'deep.txt'), 'utf8'),
    await readFile(fixture('both/web/nested/deep.txt'), 'utf8'),
    'a file deep in the archive lands where the folder had it',
  );
  assert.deepEqual(await registry(home), {
    plugins: [
      {
        name: 'both',
        place: DEFAULT_PLACE,
        directory: landed,
        grants: [],
        release: { repository: 'someone/both', version: '1.2.0' },
      },
    ],
  });

  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('href="/p/both/"'), 'the Host serves what landed');
  assert.ok(page.includes('1 Running'), 'and runs the Plugin Server out of it');
  const served = await host.fetch('/p/both/');
  assert.equal(await served.text(), await readFile(fixture('both/web/index.html'), 'utf8'));
});

test('the record of Release Files lists every file with its SHA-256, and no directories', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'git@github.com:someone/both'], github.env);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'both');
  const record = JSON.parse(await readFile(join(landed, '.firstmate-release.json'), 'utf8'));
  const files = [
    'mcp',
    'mcp.cmd',
    'private.txt',
    'web/LICENSE',
    'web/app.css',
    'web/app.js',
    'web/index.html',
    'web/nested/deep.txt',
    'web/thing.bin',
  ];
  const expected: Record<string, string> = {};
  for (const file of files) expected[file] = await sha256Of(fixture(join('both', file)));
  assert.deepEqual(record, { files: expected });
  assert.deepEqual(
    (await readdir(landed)).sort(),
    ['.firstmate-release.json', 'mcp', 'mcp.cmd', 'private.txt', 'web'],
    'the record is the one file FirstMate adds',
  );
});

test('an Official Plugin with a Plugin Release is installed the same way, from its URL', async (t) => {
  const github = await serveGitHub(t);
  github.publish('luanAfons0/worklog', await pluginRelease(t, fixture('both'), 'worklog', '2.0.1'));
  const home = await makeHome(t);

  const installed = await firstmate(home, ['install', 'worklog'], github.env);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'worklog');
  assert.ok(
    installed.stdout.includes(`installed worklog at ${landed}, Release Version 2.0.1`),
    installed.stdout,
  );
  assert.ok(await canStart(landed), 'mcp is still executable');
  assert.deepEqual((await registry(home)).plugins[0]?.release, {
    repository: 'luanAfons0/worklog',
    version: '2.0.1',
  });
  assert.deepEqual(github.asked, [
    '/repos/luanAfons0/worklog/releases?per_page=100',
    '/luanAfons0/worklog/releases/download/v2.0.1/worklog-2.0.1.tar.gz.sha256',
    '/luanAfons0/worklog/releases/download/v2.0.1/worklog-2.0.1.tar.gz',
  ]);
});

test('the newest Plugin Release is taken, and a draft, a prerelease or another tag is none', async (t) => {
  const github = await serveGitHub(t);
  const of = (version: string) => pluginRelease(t, fixture('both'), 'both', version);
  github.publish('someone/both', await of('1.2.0'));
  github.publish('someone/both', await of('1.10.0'));
  github.publish('someone/both', await of('1.9.0'));
  github.publish('someone/both', { ...(await of('2.0.0')), draft: true });
  github.publish('someone/both', { ...(await of('3.0.0')), prerelease: true });
  github.publish('someone/both', { ...(await of('4.0.0')), tag: 'v4' });
  github.publish('someone/both', { ...(await of('5.0.0')), tag: 'nightly' });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 0, installed.stderr);
  assert.match(installed.stdout, /, Release Version 1\.10\.0$/m);
  assert.equal((await registry(home)).plugins[0]?.release?.version, '1.10.0');
});

test('a Registry written before Plugin Releases is written back byte for byte', async (t) => {
  const home = await makeHome(t);
  const before = `${JSON.stringify(
    {
      plugins: [
        { name: 'both', place: DEFAULT_PLACE, directory: fixture('both'), grants: ['marker'] },
        { name: 'marker', place: DEFAULT_PLACE, directory: fixture('marker'), grants: [] },
      ],
    },
    null,
    2,
  )}\n`;
  await writeFile(join(home, 'registry.json'), before);

  const listed = await firstmate(home, ['list']);
  const revoked = await firstmate(home, ['revoke', 'both', 'marker']);
  const granted = await firstmate(home, ['grant', 'both', 'marker']);

  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.equal(granted.code, 0, granted.stderr);
  assert.equal(await readFile(join(home, 'registry.json'), 'utf8'), before);
});

test('every later write of the Registry keeps the Plugin Release of a row', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const home = await makeHome(t);
  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );
  assert.equal(installed.code, 0, installed.stderr);

  const added = await firstmate(home, ['add', 'marker', fixture('marker')]);
  const granted = await firstmate(home, ['grant', 'both', 'marker']);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(granted.code, 0, granted.stderr);
  const [both, marker] = (await registry(home)).plugins;
  assert.deepEqual(both?.grants, ['marker']);
  assert.deepEqual(both?.release, { repository: 'someone/both', version: '1.2.0' });
  assert.equal(marker !== undefined && 'release' in marker, false, 'a copy has no release');
});

test('an archive larger than 1 GiB is refused before it is downloaded', async (t) => {
  const github = await serveGitHub(t);
  github.publish('someone/both', await pluginRelease(t, fixture('both'), 'both', '1.2.0'));
  const archive = '/someone/both/releases/download/v1.2.0/both-1.2.0.tar.gz';
  github.answer(archive, {
    status: 200,
    headers: { 'content-length': String(2 * 1024 ** 3) },
    body: 'x',
  });
  const home = await makeHome(t);

  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/both'],
    github.env,
  );

  assert.equal(installed.code, 3, installed.stdout);
  assert.match(
    installed.stderr,
    /both-1\.2\.0\.tar\.gz is larger than 1 GiB, so it was not downloaded/,
  );
  assert.deepEqual(await readdir(join(home, 'shelf')).catch(() => []), []);
});
