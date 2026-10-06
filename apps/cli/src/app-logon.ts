/**
 * Start at logon, as the terminal reaches it: the entry of the system the App
 * runs on, which the App's Tray and Settings View write too (ADR-0026).
 *
 * Inside WSL and on Windows the App is the Windows App, and its entry is the
 * Run value `install-app.ts` reads and writes through reg.exe. On Linux
 * outside WSL the App is the AppImage `firstmate desktop` puts in the user's
 * applications directory, or else the deb's program, and its entry is the
 * autostart file `core` writes. Anywhere else there is no App to start at
 * logon.
 *
 * The deb's program is found as the desktop finds it: by the App's desktop
 * entry in the system's applications folders, whose Exec names it. Its place
 * is electron-builder's, `/opt/FirstMate/firstmate`, and reading the entry
 * keeps that a fact of the package, not of this file.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readAutostart, writeAutostart } from '@firstmate/core/logon';
import { appHere, appImagePath, isLinuxDesktop, logonIsOn, turnLogonOn } from './install-app.ts';

/** The name of the desktop entry the deb installs for the App. */
const DESKTOP_ENTRY = 'firstmate.desktop';

/** The system's data folders when XDG_DATA_DIRS is unset, as the XDG spec says. */
const DATA_DIRS = '/usr/local/share:/usr/share';

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
  if (isLinuxDesktop(env)) return linuxLogon(env);
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

/**
 * Start at logon on Linux: the autostart entry, which starts the AppImage, or
 * the deb's program when there is no AppImage.
 */
function linuxLogon(env: NodeJS.ProcessEnv): AppLogon {
  const appImage = appImagePath();
  const program = isFile(appImage) ? appImage : debProgram(env);
  return {
    installed: program !== undefined,
    isOn: async () => readAutostart(env),
    turnOn: async () => {
      if (program !== undefined) writeAutostart(true, program, env);
    },
  };
}

/**
 * The program the deb installed, as its desktop entry names it in the first
 * of the system's data folders that holds one, or nothing when no deb is
 * installed.
 */
function debProgram(env: NodeJS.ProcessEnv): string | undefined {
  const folders = (env['XDG_DATA_DIRS'] || DATA_DIRS).split(':').filter((dir) => dir !== '');
  for (const folder of folders) {
    let text: string;
    try {
      text = readFileSync(join(folder, 'applications', DESKTOP_ENTRY), 'utf8');
    } catch {
      continue;
    }
    // The Exec key's first word is the program; the deb writes it unquoted.
    const program = /^Exec=(\S+)/m.exec(text)?.[1];
    return program !== undefined && isFile(program) ? program : undefined;
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
