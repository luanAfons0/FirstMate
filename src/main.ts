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
import { readRegistry, registryPath } from './registry.ts';
import { removeRuntimeFile, writeRuntimeFile } from './runtime.ts';

async function main(): Promise<void> {
  const config = readConfig();
  const plugins = readRegistry(config.home);
  // The token lives in memory and in the runtime file, and is minted fresh
  // every start, so yesterday's address is worth nothing today.
  const token = randomBytes(32).toString('hex');

  const host = await startHost({
    port: config.port,
    plugins,
    registryPath: registryPath(config.home),
    token,
  });
  writeRuntimeFile(config.home, { port: host.port, token });

  // The address that admits a browser. The token is on it once: the Host
  // answers with a cookie and sends the browser to the clean address.
  console.log(`FirstMate: http://127.0.0.1:${host.port}/?token=${token}`);
  console.log(`FirstMate: ${plugins.length} Plugin(s) in ${registryPath(config.home)}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop(host, config.home);
    });
  }
}

async function stop(host: { close(): Promise<void> }, home: string): Promise<void> {
  // The runtime file describes a run. This one is over, so it goes with it.
  removeRuntimeFile(home);
  await host.close();
}

main().catch((fault: unknown) => {
  console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
  if (fault instanceof Error && fault.cause !== undefined) console.error(fault.cause);
  process.exitCode = 1;
});
