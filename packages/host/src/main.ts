/**
 * The Host: one long-running process that gives any Plugin a process, a page
 * and an address.
 *
 * Start it with `node packages/host/src/main.ts`. It reads its Registry,
 * listens on loopback, and writes the port and the token where the Tray and
 * the command line find them. It reads the Registry again when the command
 * line asks it to reload.
 */
import { randomBytes } from 'node:crypto';
import { readConfig } from '@firstmate/core/config';
import { startHost, type Host } from './host.ts';
import { openNotices } from './notices.ts';
import { readPlugins } from '@firstmate/core/plugin-places';
import { registryPath } from '@firstmate/core/registry';
import { removeRuntimeFile, runtimePath, writeRuntimeFile } from '@firstmate/core/runtime';
import { readSettings } from '@firstmate/core/settings';
import { superviseAll, type Supervisor } from './supervisor.ts';

async function main(): Promise<void> {
  const config = readConfig();
  const plugins = readPlugins(config.home);
  // The token lives in memory and in the runtime file, and is minted fresh
  // every start, so yesterday's address is worth nothing today.
  const token = randomBytes(32).toString('hex');

  // One queue of Notices for the run. It lives in memory and dies with it.
  const notices = openNotices(config.noticeMs);

  // Every Plugin Server starts before the first request can reach one.
  const supervisor = await superviseAll(
    plugins,
    { handshakeMs: config.handshakeMs, maxCallMs: config.maxCallMs },
    notices,
  );

  // From here a failure must take the Plugin Servers down with it: their pipes
  // would otherwise hold a Host that serves nothing up for ever.
  // The Shelf can move while the Host runs, and a reload reads it again.
  let shelf = config.shelf;
  const reload = async (): Promise<void> => {
    // Both are read before either is used, so a damaged file changes nothing.
    const now = readPlugins(config.home);
    const moved = readConfig().shelf;
    await supervisor.hold(now);
    shelf = moved;
    console.log(`FirstMate: reloaded ${now.length} Plugin(s) from ${registryPath(config.home)}`);
  };

  const host = await startHost({
    port: config.port,
    plugins: () => supervisor.plugins(),
    registryPath: registryPath(config.home),
    shelf: () => shelf,
    token,
    stateOf: (name) => supervisor.stateOf(name),
    serverOf: (name) => supervisor.serverOf(name),
    shortcuts: () => readSettings(config.home).shortcuts ?? [],
    order: () => readSettings(config.home).order ?? [],
    notices: (after) => notices.after(after),
    reload,
    restart: (name) => supervisor.restart(name),
  }).catch(async (fault: unknown) => {
    await supervisor.stopAll();
    throw fault;
  });
  try {
    announce(host.port, token, config.home);
    console.log(`FirstMate: ${plugins.length} Plugin(s) in ${registryPath(config.home)}`);
    // The Shelf is a setting the Host remembers, so the Host says which
    // one it read. A terminal and the Host that disagree is worth seeing.
    console.log(`FirstMate: the Shelf is ${config.shelf}`);

    // Written last, because the runtime file is how the Tray and every test
    // know the Host is up. Whoever finds it then finds everything said above.
    writeRuntimeFile(config.home, { port: host.port, token });
  } catch (fault) {
    await stop(host, supervisor, config.home);
    throw fault;
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stop(host, supervisor, config.home).catch((fault: unknown) => {
        console.error('FirstMate: the Host did not stop cleanly.', fault);
        process.exitCode = 1;
      });
    });
  }

  // A command that ran while the Host started found no runtime file, so it
  // asked nobody to reload. Whatever it wrote is read now, once.
  if (JSON.stringify(safely(() => readPlugins(config.home))) !== JSON.stringify(plugins)) {
    await reload().catch((fault: unknown) => {
      console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
    });
  }
}

/**
 * The address, for whoever started the Host.
 *
 * A person at a terminal gets the whole address, token and all, because the
 * token is what admits their browser. A service gets the address alone: its
 * output is the journal, and a journal is no place for a credential. The Tray
 * reads the token from the runtime file, which is written for this user only.
 */
function announce(port: number, token: string, home: string): void {
  if (process.stdout.isTTY) {
    console.log(`FirstMate: http://127.0.0.1:${port}/?token=${token}`);
    return;
  }
  console.log(`FirstMate: http://127.0.0.1:${port}/`);
  console.log(`FirstMate: the token to open it with is in ${runtimePath(home)}`);
}

/** What this reads, or nothing when it cannot be read. */
function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

async function stop(host: Host, supervisor: Supervisor, home: string): Promise<void> {
  // The runtime file describes a run. This one is over, so it goes with it.
  removeRuntimeFile(home);
  await Promise.all([supervisor.stopAll(), host.close()]);
}

main().catch((fault: unknown) => {
  console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
  if (fault instanceof Error && fault.cause !== undefined) console.error(fault.cause);
  process.exitCode = 1;
});
