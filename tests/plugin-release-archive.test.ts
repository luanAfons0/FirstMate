/**
 * What `install` takes from the archive of a Plugin Release, and what it
 * refuses (ADR-0033).
 *
 * The archive script never writes a hostile archive, so these tests write
 * their archives as raw tar bytes, with the small writer below, and publish
 * them on the fake GitHub. Each hostile archive is one way an entry could
 * land outside its Plugin's directory, land through a link, or fake
 * FirstMate's record of Release Files. Every one is refused by the
 * `firstmate` command in one sentence that names the entry, and leaves the
 * Registry and the Shelf as they were.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { serveGitHub } from './helpers/github.ts';
import { bootHostIn, canStart, firstmate, fixture, makeHome } from './helpers/host.ts';

/** One block of a tar archive. */
const BLOCK = 512;

/**
 * One raw entry of a tar archive: its name field, its type flag, and what
 * follows it. A name too long for its field is written whole into a pax or a
 * GNU long-name entry before it, as GNU tar would.
 */
type Raw = {
  readonly name: string;
  /** The type flag: `0` a file, `2` a link, `5` a directory, and so on. */
  readonly type?: string;
  readonly mode?: number;
  readonly body?: Buffer | string;
  /** A link's target, in its own header field. */
  readonly target?: string;
  /** The ustar prefix, which stands before the name with a `/` between. */
  readonly prefix?: string;
};

/** A file entry. */
function file(name: string, body: Buffer | string = 'data\n', mode = 0o644): Raw {
  return { name, type: '0', mode, body };
}

/** A symbolic link entry. */
function link(name: string, target: string): Raw {
  return { name, type: '2', mode: 0o777, target };
}

/** A pax header that says these records about the entry after it. */
function pax(records: Readonly<Record<string, string>>): Raw {
  let body = '';
  for (const [key, value] of Object.entries(records)) {
    const rest = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(rest) + 1;
    while (`${length}`.length + Buffer.byteLength(rest) !== length) length += 1;
    body += `${length}${rest}`;
  }
  return { name: 'PaxHeader', type: 'x', body };
}

/** A GNU long-name entry that names the entry after it. */
function gnuLongName(path: string): Raw {
  return { name: '././@LongLink', type: 'L', body: `${path}\u0000` };
}

/** One ustar header, then the body padded to whole blocks. */
function blocksOf(raw: Raw): Buffer {
  const body = Buffer.from(raw.body ?? '');
  const header = Buffer.alloc(BLOCK);
  header.write(raw.name, 0, 100, 'utf8');
  header.write(`${(raw.mode ?? 0o644).toString(8).padStart(7, '0')}\u0000`, 100, 'ascii');
  header.write('0000000\u0000', 108, 'ascii');
  header.write('0000000\u0000', 116, 'ascii');
  header.write(`${body.length.toString(8).padStart(11, '0')}\u0000`, 124, 'ascii');
  header.write('00000000000\u0000', 136, 'ascii');
  header.write(raw.type ?? '0', 156, 'ascii');
  header.write(raw.target ?? '', 157, 100, 'utf8');
  header.write('ustar\u000000', 257, 'ascii');
  header.write(raw.prefix ?? '', 345, 155, 'utf8');
  header.fill(' ', 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');
  const padding = Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, body, padding]);
}

/** A gzipped tar of these raw entries, ended by two empty blocks. */
function archiveOf(raws: readonly Raw[]): Buffer {
  return gzipSync(Buffer.concat([...raws.map(blocksOf), Buffer.alloc(BLOCK * 2)]));
}

/** The files of the fixture Plugin `both`, as raw entries, `mcp` marked executable. */
async function bothPlugin(): Promise<Raw[]> {
  const read = (path: string) => readFile(fixture(join('both', path)));
  return [
    file('mcp', await read('mcp'), 0o755),
    file('mcp.cmd', await read('mcp.cmd')),
    file('private.txt', await read('private.txt')),
    { name: 'web/', type: '5', mode: 0o755 },
    file('web/index.html', await read('web/index.html')),
  ];
}

/**
 * Publish these raw entries as the Plugin Release 1.0.0 of `someone/evil`,
 * with the `.sha256` beside it, and install it into a new home.
 */
async function install(t: TestContext, raws: readonly Raw[]) {
  const github = await serveGitHub(t);
  const archive = archiveOf(raws);
  const hash = createHash('sha256').update(archive).digest('hex');
  github.publish('someone/evil', {
    tag: 'v1.0.0',
    assets: {
      'evil-1.0.0.tar.gz': archive,
      'evil-1.0.0.tar.gz.sha256': Buffer.from(`${hash}  evil-1.0.0.tar.gz\n`),
    },
  });
  const home = await makeHome(t);
  const installed = await firstmate(
    home,
    ['install', 'https://github.com/someone/evil'],
    github.env,
  );
  return { home, installed };
}

/** Every path under this directory, relative, sorted; none when it is not there. */
async function everything(directory: string): Promise<string[]> {
  const found = await readdir(directory, { recursive: true }).catch(() => []);
  return found.map((path) => path.replaceAll('\\', '/')).sort();
}

/**
 * Each hostile archive: the entries after a good Plugin, and the name the
 * refusal must say.
 */
const HOSTILE: readonly { why: string; entries: Raw[]; names: string }[] = [
  {
    why: 'a path that climbs out with ..',
    entries: [file('../escaped')],
    names: '../escaped',
  },
  {
    why: 'a path that climbs out with .. in its middle',
    entries: [file('web/../../../escaped')],
    names: 'web/../../../escaped',
  },
  {
    why: 'a path that Windows reads as climbing out, a part of dots and spaces',
    entries: [file('web/.. /escaped')],
    names: 'web/.. /escaped',
  },
  {
    why: 'an absolute path',
    entries: [file('/tmp/escaped')],
    names: '/tmp/escaped',
  },
  {
    why: 'an absolute path of a Windows drive',
    entries: [file('C:/escaped')],
    names: 'C:/escaped',
  },
  {
    why: 'a path that is relative to a Windows drive',
    entries: [file('C:escaped')],
    names: 'C:escaped',
  },
  {
    why: 'a backslash, which Windows reads as a separator',
    entries: [file('..\\..\\escaped')],
    names: '..\\..\\escaped',
  },
  {
    why: 'a control character in a path',
    entries: [file('web/\u001b[2Jcleared')],
    names: '"web/\\u001b[2Jcleared"',
  },
  {
    why: 'a control character a terminal reads in one byte',
    entries: [file('web/\u009b2Jcleared')],
    names: '"web/\\u009b2Jcleared"',
  },
  {
    why: 'a pax path that climbs out',
    entries: [pax({ path: '../escaped' }), file('harmless')],
    names: '../escaped',
  },
  {
    why: 'a GNU long name that climbs out',
    entries: [gnuLongName('../escaped'), file('././@LongLink')],
    names: '../escaped',
  },
  {
    why: 'a ustar prefix that is absolute',
    entries: [{ ...file('escaped'), prefix: '/tmp' }],
    names: '/tmp/escaped',
  },
  {
    why: 'a link whose target is absolute',
    entries: [link('web/out', '/etc')],
    names: 'web/out',
  },
  {
    why: 'a link whose target is on a Windows drive',
    entries: [link('web/out', 'C:\\Windows')],
    names: 'web/out',
  },
  {
    why: 'a link whose target climbs out',
    entries: [link('web/out', '../../other')],
    names: 'web/out',
  },
  {
    why: 'a link whose target climbs out with backslashes',
    entries: [link('web/out', '..\\..\\other')],
    names: 'web/out',
  },
  {
    why: 'a pax link target that climbs out',
    entries: [pax({ linkpath: '../../other' }), link('web/out', 'index.html')],
    names: 'web/out',
  },
  {
    why: 'a link whose target climbs out through another link',
    entries: [link('top', '.'), link('out', 'top/..')],
    names: 'out',
  },
  {
    why: 'a link whose target climbs out through a link later in the archive',
    entries: [link('out', 'top/..'), link('top', '.')],
    names: 'out',
  },
  {
    why: 'a link whose target climbs out through a link that differs only in case',
    entries: [link('TOP', '.'), link('out', 'top/..')],
    names: 'out',
  },
  {
    why: 'a link whose target climbs out through the Windows short name of a link',
    entries: [link('a-long-link-name', '.'), link('out', 'ALONGL~1/..')],
    names: 'out',
  },
  {
    why: 'a link whose target names a Windows stream',
    entries: [link('out', 'web::$INDEX_ALLOCATION/..')],
    names: 'out',
  },
  {
    why: 'a link whose target is empty',
    entries: [link('out', '')],
    names: 'out',
  },
  {
    why: 'a link, then a file written through it',
    entries: [link('lib', 'web'), file('lib/written-through')],
    names: 'lib/written-through',
  },
  {
    why: 'a link, then a file written through it under a name that differs only in case',
    entries: [link('lib', 'web'), file('LIB/written-through')],
    names: 'LIB/written-through',
  },
  {
    why: 'a link, then a file of the same name written through it',
    entries: [link('alias', 'web/index.html'), file('alias')],
    names: 'alias',
  },
  {
    why: 'a file twice',
    entries: [file('mcp', '#!/bin/sh\necho replaced\n', 0o755)],
    names: 'mcp',
  },
  {
    why: 'two files whose names differ only in case',
    entries: [file('MCP', '#!/bin/sh\necho replaced\n', 0o755)],
    names: 'MCP',
  },
  {
    why: 'a file where a directory is',
    entries: [file('web')],
    names: 'web',
  },
  {
    why: 'a hard link',
    entries: [{ name: 'hard', type: '1', target: 'mcp' }],
    names: 'hard',
  },
  {
    why: 'a device',
    entries: [{ name: 'dev', type: '3' }],
    names: 'dev',
  },
  {
    why: 'a FIFO',
    entries: [{ name: 'fifo', type: '6' }],
    names: 'fifo',
  },
  {
    why: 'an entry named .firstmate-release.json',
    entries: [file('.firstmate-release.json', '{"files":{}}\n')],
    names: '.firstmate-release.json',
  },
  {
    why: 'an entry named .firstmate-release.json in another case',
    entries: [file('.FirstMate-Release.json', '{"files":{}}\n')],
    names: '.FirstMate-Release.json',
  },
  {
    why: 'a link named .firstmate-release.json',
    entries: [link('.firstmate-release.json', 'mcp')],
    names: '.firstmate-release.json',
  },
];

for (const { why, entries, names } of HOSTILE) {
  test(`an archive with ${why} is refused, and nothing lands`, async (t) => {
    const { home, installed } = await install(t, [...(await bothPlugin()), ...entries]);

    assert.notEqual(installed.code, 0, installed.stdout);
    assert.ok(installed.stderr.includes(`someone/evil holds ${names},`), installed.stderr);
    assert.equal(installed.stderr.trim().split('\n').length, 1, installed.stderr);
    assert.deepEqual(await everything(join(home, 'shelf')), [], 'the Shelf is as it was');
    assert.deepEqual(await everything(home), ['shelf'], 'no Registry, and nothing outside');
  });
}

test('a link that stays inside the Plugin directory lands as the archive has it', async (t) => {
  const { home, installed } = await install(t, [
    ...(await bothPlugin()),
    link('web/same', 'index.html'),
    link('web/up', '../private.txt'),
    link('web/top', '..'),
    link('web/through', 'up'),
    link('also-web', 'web/'),
  ]);

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'evil');
  const index = await readFile(fixture('both/web/index.html'), 'utf8');
  const secret = await readFile(fixture('both/private.txt'), 'utf8');
  assert.equal(await readFile(join(landed, 'web', 'same'), 'utf8'), index);
  assert.equal(await readFile(join(landed, 'web', 'up'), 'utf8'), secret);
  assert.equal(await readFile(join(landed, 'web', 'top', 'private.txt'), 'utf8'), secret);
  assert.equal(await readFile(join(landed, 'web', 'through'), 'utf8'), secret);
  assert.equal(await readFile(join(landed, 'also-web', 'index.html'), 'utf8'), index);
  assert.equal((await readlink(join(landed, 'web', 'same'))).replaceAll('\\', '/'), 'index.html');
});

test('a file marked executable in the archive is executable once installed, and the Host starts it', async (t) => {
  const { home, installed } = await install(t, await bothPlugin());

  assert.equal(installed.code, 0, installed.stderr);
  const landed = join(home, 'shelf', 'evil');
  assert.ok(await canStart(landed), 'mcp is executable');
  if (process.platform !== 'win32') {
    const mode = (await stat(join(landed, 'private.txt'))).mode;
    assert.equal(mode & 0o111, 0, 'a file not marked executable is not made so');
  }
  const host = await bootHostIn(t, home);
  const page = await (await host.fetch('/')).text();
  assert.ok(page.includes('1 Running'), 'the Host starts the Plugin Server it unpacked');
});
