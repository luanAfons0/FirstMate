/**
 * Start the Host, and stop it again.
 *
 * The Host reads its Registry, starts every Plugin Server, listens on
 * loopback, and writes the port and the token where the Tray and the command
 * line find them. It reads the Registry again when the command line asks it
 * to reload.
 *
 * This is a function and not a side effect of an import, because two programs
 * start the Host: `main.ts`, which stops it on a signal, and the App, which
 * stops it when the operator quits (ADR-0020). Both stop it the same way, so
 * no Plugin Server outlives either.
 */
import { randomBytes } from 'node:crypto';
import { BIND_ADDRESS, readConfig, type Config } from '@firstmate/core/config';
import { startHost } from './host.ts';
import { keepLog } from './log.ts';
import { openNotices, type Notice } from './notices.ts';
import { readPlugins } from '@firstmate/core/plugin-places';
import { registryPath } from '@firstmate/core/registry';
import { removeRuntimeFile, runtimePath, writeRuntimeFile } from '@firstmate/core/runtime';
import { readSettings } from '@firstmate/core/settings';
import { superviseAll } from './supervisor.ts';

/** A Host that runs, and the way to stop it. */
export type RunningHost = {
  /** The port the Host listens on. */
  readonly port: number;
  /** The token that admits a browser. It is never printed by whoever holds it. */
  readonly token: string;
  /**
   * Read the Registry and the settings again, as `POST /reload` does. The App
   * calls it after its Settings View writes a setting, so that no page ever
   * asks the Host to reload (ADR-0018).
   */
  reload(): Promise<void>;
  /**
   * Remove the runtime file, end every Plugin Server and close the HTTP
   * server. A second call waits for the first rather than stopping twice.
   */
  stop(): Promise<void>;
};

/**
 * What the program that holds the Host hears from it, in its own process. The
 * App uses it to keep the Tray right without asking the Host on a timer.
 */
export type HostHooks = {
  /** Called with each Notice the Host takes, from a Plugin Server or its own. */
  readonly onNotice?: (notice: Notice) => void;
  /**
   * Called after anything that can change what `/plugins.json` says: a
   * reload, a restart, and every Notice, because a Notice is how the Host
   * says that a Plugin went Stopped.
   */
  readonly onChange?: () => void;
};

/** Start the Host for this Config, and resolve once it listens and has said so. */
export async function start(
  config: Config = readConfig(),
  hooks: HostHooks = {},
): Promise<RunningHost> {
  // A hook that throws is the holder's fault, and must not break the Host.
  const tell = (hook: (() => void) | undefined): void => {
    try {
      hook?.();
    } catch (fault: unknown) {
      console.error('FirstMate: a hook of the program that holds the Host failed.', fault);
    }
  };

  const plugins = readPlugins(config.home);
  // The token lives in memory and in the runtime file, and is minted fresh
  // every start, so yesterday's address is worth nothing today.
  const token = randomBytes(32).toString('hex');
  // Kept from here, so the log holds every Plugin Server's start as well.
  keepLog(config.home, token);

  // One queue of Notices for the run. It lives in memory and dies with it.
  const notices = openNotices(config.noticeMs, Date.now, (notice) => {
    tell(() => hooks.onNotice?.(notice));
    tell(hooks.onChange);
  });

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
    tell(hooks.onChange);
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
    restart: async (name) => {
      const restarted = await supervisor.restart(name);
      tell(hooks.onChange);
      return restarted;
    },
  }).catch(async (fault: unknown) => {
    await supervisor.stopAll();
    throw portTaken(fault, config.port) ?? fault;
  });

  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    // The runtime file describes a run. This one is over, so it goes with it.
    stopped ??= (async () => {
      removeRuntimeFile(config.home);
      await Promise.all([supervisor.stopAll(), host.close()]);
    })();
    return stopped;
  };

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
    await stop();
    throw fault;
  }

  // A command that ran while the Host started found no runtime file, so it
  // asked nobody to reload. Whatever it wrote is read now, once.
  if (JSON.stringify(safely(() => readPlugins(config.home))) !== JSON.stringify(plugins)) {
    await reload().catch((fault: unknown) => {
      console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
    });
  }

  return { port: host.port, token, reload, stop };
}

/**
 * The one sentence for a port another program holds, or nothing when the
 * fault is another one. The system's own words stay on as the cause.
 */
function portTaken(fault: unknown, port: number): Error | undefined {
  if (!(fault instanceof Error) || !('code' in fault) || fault.code !== 'EADDRINUSE') {
    return undefined;
  }
  return new Error(
    `Another program already listens on ${BIND_ADDRESS}:${port}. ` +
      'Close it, or set FIRSTMATE_PORT to another port.',
    { cause: fault },
  );
}

/**
 * The address, for whoever started the Host.
 *
 * A person at a terminal gets the whole address, token and all, because the
 * token is what admits their browser. A service gets the address alone: its
 * output is the journal, and a journal is no place for a credential. The Tray
 * reads the token from the runtime file, which is written for this user only.
 * The App has no terminal, so it gets the address alone too.
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
