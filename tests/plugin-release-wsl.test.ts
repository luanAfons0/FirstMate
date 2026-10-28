/**
 * Installing and updating a Plugin Release in a `wsl` Place: the archive is
 * the one for the distribution's own arch, it is downloaded, checked and
 * unpacked on this side, written through the Place's root, and then one
 * command inside the distribution gives the executable files their bit back,
 * before they move into place (ADR-0033). The distribution needs nothing for
 * it but `chmod` and `uname`.
 *
 * GitHub is the fake in `helpers/github.ts` and the distribution is the fake
 * in `helpers/wsl.ts`.
 */
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pluginRelease, serveGitHub } from './helpers/github.ts';
import { firstmate, makeHome } from './helpers/host.ts';
import { fakeWsl, NO_FAKE_WSL } from './helpers/wsl.ts';

/** A Plugin folder with two executable files and one that is not. */
async function folderWithTools(t: TestContext): Promise<string> {
  const folder = await makeHome(t);
  await mkdir(join(folder, 'bin'));
  await writeFile(join(folder, 'mcp'), '#!/bin/sh\nexit 0\n');
  await writeFile(join(folder, 'bin', 'tool'), '#!/bin/sh\nexit 0\n');
  await writeFile(join(folder, 'README.txt'), 'plain\n');
  await chmod(join(folder, 'mcp'), 0o755);
  await chmod(join(folder, 'bin', 'tool'), 0o755);
  return folder;
}

/** A `uname` that says this machine, as a distribution of another arch would. */
async function unameSaying(t: TestContext, machine: string): Promise<string> {
  const bin = await makeHome(t);
  await writeFile(join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' '${machine}'\n`);
  await chmod(join(bin, 'uname'), 0o755);
  return bin;
}

test(
  'a Plugin Release lands through the root, and one chmod names its executable files',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const github = await serveGitHub(t);
    const folder = await folderWithTools(t);
    const universal = await pluginRelease(t, folder, 'tools', '1.0.0');
    const linux = await pluginRelease(t, folder, 'tools', '1.0.0', 'linux-x64');
    github.publish('someone/tools', {
      tag: 'v1.0.0',
      assets: { ...universal.assets, ...linux.assets },
    });
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], wsl.env);
    const env = { ...wsl.env, ...github.env };

    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/tools', '--place', 'deb'],
      env,
    );

    const inside = '/home/mate/.firstmate/shelf/tools';
    const pending = '/home/mate/.firstmate/shelf/.tools.pending';
    assert.equal(installed.code, 0, installed.stderr);
    assert.ok(installed.stdout.includes(`installed tools at ${inside}`), installed.stdout);
    assert.ok((await stat(join(wsl.root, inside, 'bin', 'tool'))).isFile(), 'landed in the root');
    assert.ok(github.asked.some((path) => path.endsWith('tools-1.0.0-linux-x64.tar.gz')));
    const chmods = (await wsl.calls()).filter((call) => call.includes('chmod'));
    assert.deepEqual(chmods, [`wsl.exe -d Debian --cd ${pending} --exec chmod +x bin/tool mcp`]);
    const [row] = JSON.parse(await readFile(join(home, 'registry.json'), 'utf8')).plugins;
    assert.deepEqual(row, {
      name: 'tools',
      place: 'deb',
      directory: inside,
      grants: [],
      release: { repository: 'someone/tools', version: '1.0.0' },
    });
  },
);

test(
  'the archive is the distribution arch, then the one for every platform',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const github = await serveGitHub(t);
    const folder = await folderWithTools(t);
    const universal = await pluginRelease(t, folder, 'tools', '1.0.0');
    const x64 = await pluginRelease(t, folder, 'tools', '1.0.0', 'linux-x64');
    github.publish('someone/tools', {
      tag: 'v1.0.0',
      assets: { ...universal.assets, ...x64.assets },
    });
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    const uname = await unameSaying(t, 'aarch64');
    const env = {
      PATH: `${uname}${delimiter}${wsl.env['PATH'] ?? ''}`,
      ...github.env,
    };
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], env);

    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/tools', '--place', 'deb'],
      env,
    );

    assert.equal(installed.code, 0, installed.stderr);
    const archives = github.asked.filter((path) => path.endsWith('.tar.gz'));
    assert.deepEqual(
      archives.map((path) => path.split('/').pop()),
      ['tools-1.0.0.tar.gz'],
      'no linux-arm64 archive, so the one for every platform; not the x64 one',
    );
  },
);

test(
  'update takes the archive for the distribution arch, and gives every executable file its bit back',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const github = await serveGitHub(t);
    const folder = await folderWithTools(t);
    github.publish('someone/tools', await pluginRelease(t, folder, 'tools', '1.0.0'));
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    const uname = await unameSaying(t, 'aarch64');
    const env = { PATH: `${uname}${delimiter}${wsl.env['PATH'] ?? ''}`, ...github.env };
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], env);
    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/tools', '--place', 'deb'],
      env,
    );
    assert.equal(installed.code, 0, installed.stderr);
    await writeFile(join(folder, 'bin', 'tool'), '#!/bin/sh\nexit 1\n');
    const universal = await pluginRelease(t, folder, 'tools', '1.1.0');
    const x64 = await pluginRelease(t, folder, 'tools', '1.1.0', 'linux-x64');
    github.publish('someone/tools', {
      tag: 'v1.1.0',
      assets: { ...universal.assets, ...x64.assets },
    });

    const updated = await firstmate(home, ['update', 'tools'], env);

    assert.equal(updated.code, 0, updated.stderr);
    assert.ok(updated.stdout.includes('updated tools from 1.0.0 to 1.1.0'), updated.stdout);
    const archives = github.asked.filter((path) => path.endsWith('.tar.gz'));
    assert.deepEqual(
      archives.map((path) => path.split('/').pop()),
      ['tools-1.0.0.tar.gz', 'tools-1.1.0.tar.gz'],
      'no linux-arm64 archive, so the one for every platform; never the x64 one',
    );
    const pending = '/home/mate/.firstmate/shelf/.tools.pending';
    const chmods = (await wsl.calls()).filter((call) => call.includes('chmod'));
    assert.deepEqual(chmods, [
      `wsl.exe -d Debian --cd ${pending} --exec chmod +x bin/tool mcp`,
      `wsl.exe -d Debian --cd ${pending} --exec chmod +x bin/tool mcp`,
    ]);
    const inside = join(wsl.root, '/home/mate/.firstmate/shelf/tools');
    assert.equal(await readFile(join(inside, 'bin', 'tool'), 'utf8'), '#!/bin/sh\nexit 1\n');
  },
);

test(
  'a chmod that fails leaves nothing in the Shelf, and no row',
  { skip: NO_FAKE_WSL },
  async (t) => {
    const github = await serveGitHub(t);
    const folder = await folderWithTools(t);
    github.publish('someone/tools', await pluginRelease(t, folder, 'tools', '1.0.0'));
    const home = await makeHome(t);
    const wsl = await fakeWsl(t, ['Debian']);
    const failing = await makeHome(t);
    await writeFile(join(failing, 'chmod'), '#!/bin/sh\necho "chmod: no" >&2\nexit 1\n');
    await chmod(join(failing, 'chmod'), 0o755);
    const env = { PATH: `${failing}${delimiter}${wsl.env['PATH'] ?? ''}`, ...github.env };
    await firstmate(home, ['place', 'add', 'deb', 'wsl', 'Debian', wsl.root], env);

    const installed = await firstmate(
      home,
      ['install', 'https://github.com/someone/tools', '--place', 'deb'],
      env,
    );

    assert.equal(installed.code, 1, installed.stdout);
    assert.match(installed.stderr, /could not be made executable/);
    assert.deepEqual(await readdir(join(wsl.root, '/home/mate/.firstmate/shelf')), []);
    const again = await firstmate(
      home,
      ['install', 'https://github.com/someone/tools', '--place', 'deb'],
      { ...wsl.env, ...github.env },
    );
    assert.equal(again.code, 0, again.stderr);
  },
);
