/**
 * The Host: one long-running process that gives any Plugin a process, a page
 * and an address.
 *
 * Start it with `node src/main.ts`. It reads its Registry, listens on
 * loopback, and writes the port and the token where the Tray finds them.
 */
import { randomBytes } from 'node:crypto';
import { readConfig } from './config.ts';
import { startHost } from './host.ts';
import { openNotices } from './notices.ts';
import { readRegistry, registryPath } from './registry.ts';
import { removeRuntimeFile, runtimePath, writeRuntimeFile } from './runtime.ts';
import { readSettings } from './settings.ts';
import { superviseAll, type Supervisor } from './supervisor.ts';

async function main(): Promise<void> {
  const config = readConfig();
  const plugins = readRegistry(config.home);
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

  const host = await startHost({
    port: config.port,
    plugins,
    registryPath: registryPath(config.home),
    shelf: config.shelf,
    token,
    stateOf: (name) => supervisor.stateOf(name),
    serverOf: (name) => supervisor.serverOf(name),
    shortcuts: () => readSettings(config.home).shortcuts ?? [],
    notices: (after) => notices.after(after),
  });
  announce(host.port, token, config.home);
  console.log(`FirstMate: ${plugins.length} Plugin(s) in ${registryPath(config.home)}`);
  // The Shelf is a setting the Host remembers, so the Host says which
  // one it read. A terminal and the Host that disagree is worth seeing.
  console.log(`FirstMate: the Shelf is ${config.shelf}`);

  // Written last, because the runtime file is how the Tray and every test
  // know the Host is up. Whoever finds it then finds everything said above.
  writeRuntimeFile(config.home, { port: host.port, token });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop(host, supervisor, config.home);
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

async function stop(
  host: { close(): Promise<void> },
  supervisor: Supervisor,
  home: string,
): Promise<void> {
  // The runtime file describes a run. This one is over, so it goes with it.
  removeRuntimeFile(home);
  supervisor.stopAll();
  await host.close();
}

main().catch((fault: unknown) => {
  console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
  if (fault instanceof Error && fault.cause !== undefined) console.error(fault.cause);
  process.exitCode = 1;
});
