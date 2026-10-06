/**
 * Start at logon, as the terminal reaches it: the entry of the system the App
 * runs on, which the App's Tray and Settings View write too (ADR-0026).
 *
 * Inside WSL and on Windows the App is the Windows App, and its entry is the
 * Run value `install-app.ts` reads and writes through reg.exe. On Linux
 * outside WSL the App is the AppImage `firstmate desktop` puts in the user's
 * applications directory, and its entry is the autostart file `core` writes.
 * Anywhere else there is no App to start at logon.
 */
import { statSync } from 'node:fs';
import { readAutostart, writeAutostart } from '@firstmate/core/logon';
import { appHere, appImagePath, logonIsOn, turnLogonOn } from './install-app.ts';

/** Start at logon of the App on this machine. */
export type AppLogon = {
  /** Whether the App is installed, so there is a program to start. */
  readonly installed: boolean;
  /** Whether the App starts at logon. */
  readonly isOn: () => Promise<boolean>;
  /** Have the App start at logon. */
  readonly turnOn: () => Promise<void>;
};

/**
 * Start at logon of the App on this machine, or nothing where no App can run:
 * on macOS, or on Windows and in WSL where Windows cannot be reached.
 */
export async function appLogon(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppLogon | undefined> {
  if (process.platform === 'linux' && (env['WSL_DISTRO_NAME'] ?? '') === '') {
    return linuxLogon(env);
  }
  const here = await appHere(env);
  if (here === undefined) return undefined;
  const { installed } = here;
  return {
    installed: installed !== undefined,
    isOn: () => logonIsOn(here),
    turnOn: async () => {
      if (installed !== undefined) await turnLogonOn(installed);
    },
  };
}

/** Start at logon on Linux: the autostart entry, which starts the AppImage. */
function linuxLogon(env: NodeJS.ProcessEnv): AppLogon {
  const program = appImagePath();
  return {
    installed: isFile(program),
    isOn: async () => readAutostart(env),
    turnOn: async () => writeAutostart(true, program, env),
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
