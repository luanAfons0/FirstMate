/**
 * The Host as a systemd user service inside WSL Debian (ADR-0007).
 *
 * The unit is written from a template held here rather than from a file beside
 * the program, so that `firstmate service on` works from the published package,
 * which ships no `systemd/` and no `scripts/`. It starts the program that ran
 * the command: the absolute path of this Node, because the service's PATH has
 * no nvm, and the Host entry point beside this file, which is the clone's
 * `src/main.ts` in a clone and the package's `dist/main.js` in an install.
 *
 * `off` removes exactly the file `on` wrote. Neither turns lingering off: other
 * services can depend on it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What `service` and every other caller say where there is no systemd. */
export const NO_SYSTEMD =
  'No systemd here, so the Host does not run as a service. Start it with `firstmate start`.';

/** The unit's name, which is also how `systemctl` is asked about it. */
const UNIT = 'firstmate.service';

/** The oldest Node that runs the Host. */
const OLDEST_NODE = 24;

/** This file, in a clone or in the build. */
const HERE = fileURLToPath(import.meta.url);

/** The root of the program that is running: the clone, or the installed package. */
const ROOT = dirname(dirname(HERE));

/**
 * Install the Host as a systemd user service, start it, and turn lingering on.
 *
 * It prints one line per thing done. A lingering refusal is a warning, because
 * the service runs without it until WSL next stops; every other failure throws
 * a sentence that names the command and what it said.
 */
export function serviceOn(env: NodeJS.ProcessEnv = process.env): void {
  // An older Node starts, then fails on the first import it cannot read,
  // inside a service that restarts it until systemd gives up. Refusing here
  // says why.
  const major = Number(process.versions.node.split('.')[0]);
  if (major < OLDEST_NODE) {
    throw new Error(
      `${process.execPath} is Node v${process.versions.node}. ` +
        `The Host needs Node ${OLDEST_NODE} or later.`,
    );
  }
  needSystemd(env);

  const path = unitPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, unit(), 'utf8');

  run(env, 'systemctl', ['--user', 'daemon-reload']);
  run(env, 'systemctl', ['--user', 'enable', '--now', UNIT]);

  // WSL2 stops a distribution when its last process exits, and a user service
  // needs the user's own systemd running. Lingering starts it at boot instead
  // of at login (ADR-0007).
  const user = env['USER'] || userInfo().username;
  if (attempt(env, 'loginctl', ['enable-linger', user]).status !== 0) {
    console.error(
      `firstmate: could not enable lingering. Run: sudo loginctl enable-linger ${user}`,
    );
  }

  console.log(`firstmate: installed ${path}`);
  console.log('firstmate: read it with  journalctl --user -u firstmate -f');
  const logon = logonTask(env, 'install-logon-task.ps1');
  if (logon !== undefined) {
    console.log(
      'firstmate: to hold WSL up while you are logged in to Windows, run this once on Windows:',
    );
    console.log(logon);
  }
}

/**
 * Stop the service and remove the unit `serviceOn` wrote. With no unit there is
 * nothing to take away, and it says so and succeeds, so it is safe to run twice.
 */
export function serviceOff(env: NodeJS.ProcessEnv = process.env): void {
  needSystemd(env);

  const path = unitPath(env);
  if (statSync(path, { throwIfNoEntry: false }) === undefined) {
    console.log(`firstmate: there is no service to remove at ${path}`);
  } else {
    run(env, 'systemctl', ['--user', 'disable', '--now', UNIT]);
    rmSync(path, { force: true });
    run(env, 'systemctl', ['--user', 'daemon-reload']);
    console.log(`firstmate: removed ${path}`);
    console.log('firstmate: lingering is left on.');
  }

  const logon = logonTask(env, 'uninstall-logon-task.ps1');
  if (logon !== undefined) {
    console.log('firstmate: to remove the logon task that holds WSL up, run this on Windows:');
    console.log(logon);
  }
}

/** The command that restarts the Host, for a person to run by hand. */
export const RESTART_COMMAND = 'systemctl --user restart firstmate';

/** Whether the Host runs as a service now, and whether it could. */
export type ServiceState = 'active' | 'inactive' | 'no-systemd';

/** Ask systemd whether the Host's service is running. */
export function serviceState(env: NodeJS.ProcessEnv = process.env): ServiceState {
  try {
    needSystemd(env);
  } catch {
    return 'no-systemd';
  }
  const active = attempt(env, 'systemctl', ['--user', 'is-active', '--quiet', 'firstmate']);
  return active.error === undefined && active.status === 0 ? 'active' : 'inactive';
}

/**
 * Restart the Host's service, so that it reads the Registry again. The
 * Registry is read only when the Host starts.
 */
export function restartService(env: NodeJS.ProcessEnv = process.env): void {
  const [command = 'systemctl', ...argv] = RESTART_COMMAND.split(' ');
  run(env, command, argv);
}

/**
 * Refuse where there is no systemd to ask: no `systemctl` on the PATH, or no
 * user manager behind it.
 */
function needSystemd(env: NodeJS.ProcessEnv): void {
  const probe = attempt(env, 'systemctl', ['--user', 'show-environment']);
  if (probe.error !== undefined || probe.status !== 0) throw new Error(NO_SYSTEMD);
}

/** Where the unit lives: the user's own systemd directory, as XDG says. */
function unitPath(env: NodeJS.ProcessEnv): string {
  const config = env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(config, 'systemd', 'user', UNIT);
}

/** The unit, filled in with this Node and this program. */
function unit(): string {
  // The Host entry point beside this file, with this file's own extension:
  // main.ts beside cli.ts in a clone, main.js beside cli.js in the build.
  const main = join(dirname(HERE), `main${extname(HERE)}`);
  return `# The Host as a systemd user service inside WSL Debian (ADR-0007).
# Written by \`firstmate service on\`, and removed by \`firstmate service off\`.

[Unit]
Description=FirstMate Host
Documentation=https://github.com/luanAfons0/FirstMate
After=default.target

# A failure that repeats is left alone, so a broken Host is visible rather than
# spinning behind the operator's back.
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${specifiers(ROOT)}
# Quoted, so that a path with a space in it is still one argument.
ExecStart=${quoted(process.execPath)} ${quoted(main)}

# The Host keeps no logs of its own, and neither do its Plugin Servers: their
# output passes through to the Host's, and the journal takes it (ADR-0005).
StandardOutput=journal
StandardError=journal
SyslogIdentifier=firstmate

# The Host itself may be restarted; a Plugin Server may not (issue #6).
Restart=on-failure
RestartSec=5

# Stopping closes the Plugin Servers and removes the runtime file.
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=default.target
`;
}

/** A path with systemd's `%` specifiers made literal. */
function specifiers(path: string): string {
  return path.replaceAll('%', '%%');
}

/** One argument of `ExecStart`, quoted, with nothing in it that systemd expands. */
function quoted(path: string): string {
  return `"${specifiers(path).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '$$$$')}"`;
}

/**
 * The PowerShell command that installs or removes the Windows logon task from
 * this program's own `windows/` directory, when this runs inside WSL. It is
 * only printed: a WSL command does not write Windows state.
 */
function logonTask(env: NodeJS.ProcessEnv, script: string): string | undefined {
  const distribution = env['WSL_DISTRO_NAME'];
  if (distribution === undefined || distribution === '') return undefined;
  const path = `\\\\wsl.localhost\\${distribution}${join(ROOT, 'windows', script).replaceAll('/', '\\')}`;
  const file = path.includes(' ') ? `"${path}"` : path;
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${file}`;
}

/** Run a command that must work, and throw what it said when it does not. */
function run(env: NodeJS.ProcessEnv, command: string, argv: readonly string[]): void {
  const done = attempt(env, command, argv);
  if (done.error === undefined && done.status === 0) return;
  const said = done.error?.message ?? `${done.stderr}${done.stdout}`.trim();
  throw new Error(`\`${[command, ...argv].join(' ')}\` failed: ${said || `exit ${done.status}`}`);
}

function attempt(env: NodeJS.ProcessEnv, command: string, argv: readonly string[]) {
  return spawnSync(command, argv, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
