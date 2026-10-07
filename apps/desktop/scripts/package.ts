/**
 * Package the App in three passes: the unpacked App, the installers built from
 * it, and the update feed written from the installers' final bytes.
 *
 * A release signs between the passes (ADR-0027). The unpacked App is signed
 * before an installer is built around it, because Smart App Control checks
 * every program file when the App starts, and an installer is signed after it
 * is built. A signature changes the bytes, so the update feed, its SHA-512 and
 * its size, and the installer's block map are written last, or electron-updater
 * refuses the update. Each pass is its own command so the release workflow can
 * sign between them; with no pass named, the three run in a row and sign
 * nothing, for a contributor, a pull request and the tests.
 *
 *   node scripts/package.ts [unpacked | installers | feed] [electron-builder options]
 *
 * The options go to electron-builder as they are. The one this script reads too
 * is `--config.directories.output`, which moves packaging's output.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What a block map build says about the file it read. */
type Built = {
  /** The file's size in bytes. */
  readonly size: number;
  /** The file's SHA-512, in base64, as the update feed writes it. */
  readonly sha512: string;
};

/** The three passes, in the order a release runs them. */
const PASSES = ['unpacked', 'installers', 'feed'] as const;

type Pass = (typeof PASSES)[number];

/** The option that moves packaging's output, as electron-builder reads it. */
const OUTPUT_OPTION = '--config.directories.output=';

/** Where electron-builder.yml puts packaging's output when nothing moves it. */
const DEFAULT_OUTPUT = 'dist';

/**
 * The unpacked App's directory under the output, by system. The release
 * runners are x64, the arch electron-builder leaves out of the name.
 */
const UNPACKED: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  win32: 'win-unpacked',
  linux: 'linux-unpacked',
};

/** electron-builder's command line, run by this Node, so no shell is between. */
const BUILDER = fileURLToPath(import.meta.resolve('electron-builder/cli.js'));

const fromBuilder = createRequire(BUILDER);

/**
 * electron-builder's own block map builder, the one it runs while packaging,
 * so the block map is in the form electron-updater reads. It comes with
 * electron-builder, so it adds no dependency.
 */
const { buildBlockMap } = fromBuilder('app-builder-lib/out/targets/blockmap/blockmap') as {
  buildBlockMap(file: string, compression: 'gzip', out: string): Promise<Built>;
};

await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<void> {
  const [first, ...rest] = argv;
  const named = PASSES.find((pass) => pass === first);
  const options = named === undefined ? argv : rest;
  const output = resolve(
    options.find((option) => option.startsWith(OUTPUT_OPTION))?.slice(OUTPUT_OPTION.length) ??
      DEFAULT_OUTPUT,
  );
  for (const pass of named === undefined ? PASSES : [named]) {
    await run(pass, output, options);
  }
}

/** Run one pass. */
async function run(pass: Pass, output: string, options: readonly string[]): Promise<void> {
  if (pass === 'unpacked') {
    // Not `--dir`. electron-builder writes resources/app-update.yml, which
    // tells the App where its updates are, only when it packs for a target
    // electron-updater serves, such as NSIS; packing for `dir` leaves it out,
    // and the prepackaged pass packs nothing. So this pass packages in full,
    // and the installers it makes are made again from the unpacked App.
    await builder([...options]);
  } else if (pass === 'installers') {
    await builder(['--prepackaged', unpacked(output), ...options]);
  } else {
    await writeFeeds(output);
  }
}

/** The unpacked App, which the installers pass builds from. */
function unpacked(output: string): string {
  const name = UNPACKED[process.platform];
  if (name === undefined) {
    throw new Error(`The App is packaged on Windows and Linux only, not on ${process.platform}.`);
  }
  const directory = join(output, name);
  if (!existsSync(directory)) {
    throw new Error(`There is no unpacked App at ${directory}. Run the unpacked pass first.`);
  }
  return directory;
}

/** Run electron-builder, which publishes nothing: the release workflow does. */
function builder(argv: readonly string[]): Promise<void> {
  const child = spawn(process.execPath, [BUILDER, ...argv, '--publish', 'never'], {
    stdio: 'inherit',
  });
  return new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`electron-builder exited ${code}.`)),
    );
  });
}

/**
 * Rewrite every update feed in the output, `latest.yml` on Windows and
 * `latest-linux.yml` on Linux, so that each file it names carries the SHA-512
 * and the size of that file as it is now. A file with a block map beside it,
 * the Windows installer, gets its block map written again from the same bytes.
 */
async function writeFeeds(output: string): Promise<void> {
  const feeds = (await readdir(output)).filter((name) => /^latest.*\.yml$/.test(name));
  if (feeds.length === 0) throw new Error(`There is no update feed in ${output} to write.`);
  for (const feed of feeds) {
    const path = join(output, feed);
    await writeFile(path, await rewriteFeed(await readFile(path, 'utf8'), output, feed));
  }
}

/**
 * One feed, rewritten line by line. Its form is electron-builder's, and fixed:
 * a `files` list whose entries name a file by `url`, each with its `sha512`
 * and `size`, then the main file by `path` with its `sha512`. Every other
 * line is kept as it is.
 */
async function rewriteFeed(text: string, output: string, feed: string): Promise<string> {
  const lines = text.split('\n');
  let named: Built | undefined;
  for (const [index, line] of lines.entries()) {
    const file = /^(?: {2}- url|path): (.+)$/.exec(line)?.[1];
    if (file !== undefined) {
      named = await describe(join(output, file), feed);
      continue;
    }
    const field = /^(\s*)(sha512|size): /.exec(line);
    if (field === null) continue;
    if (named === undefined) throw new Error(`${feed} gives a ${field[2]} before it names a file.`);
    const value = field[2] === 'sha512' ? named.sha512 : String(named.size);
    lines[index] = `${field[1]}${field[2]}: ${value}`;
  }
  return lines.join('\n');
}

/** The size and SHA-512 of one file a feed names, its block map written again. */
async function describe(file: string, feed: string): Promise<Built> {
  if (!existsSync(file)) throw new Error(`${feed} names ${file}, which is not there.`);
  const map = `${file}.blockmap`;
  if (existsSync(map)) return buildBlockMap(file, 'gzip', map);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return { sha512: hash.digest('base64'), size: (await stat(file)).size };
}
