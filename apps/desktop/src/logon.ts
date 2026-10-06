/**
 * Start at logon, as the App reads and writes it: the entry `setup` writes
 * too (ADR-0024, ADR-0026), so each sees what the other wrote.
 *
 * On Windows it is the Run entry, which Electron writes. On Linux Electron
 * writes no entry, so the App writes the autostart entry through `core`, as
 * `setup` does. The Tray and the Settings View both turn it on and off, and
 * both read it here, so neither keeps an answer of its own that the other
 * could leave wrong. It is off until the operator turns it on.
 */
import { app } from 'electron';
import { AT_LOGON, LOGON_NAME, readAutostart, writeAutostart } from '@firstmate/core/logon';

/**
 * The logon entry, named as `setup` names it. Electron would write it under a
 * name of its own, and then neither would find the other's entry.
 */
const LOGON = { name: LOGON_NAME, path: process.execPath, args: [AT_LOGON] };

/**
 * The program the autostart entry starts on Linux. An AppImage runs from a
 * mount that changes on each start, so the entry names the AppImage itself,
 * which its runtime gives as APPIMAGE. An installed program is its own path.
 */
function linuxProgram(): string {
  return process.env['APPIMAGE'] || process.execPath;
}

/**
 * Whether the App starts at logon. On Windows, Electron reads its answer
 * under a name of its own and takes no other, so the entry is found by its
 * name among every entry that starts this executable. One turned off in Task
 * Manager is off.
 */
export function readLogon(): boolean {
  if (process.platform === 'linux') return readAutostart();
  const { launchItems } = app.getLoginItemSettings({ path: LOGON.path, args: LOGON.args });
  return launchItems.some((item) => item.name === LOGON_NAME && item.enabled);
}

/** Turn start at logon on or off. */
export function writeLogon(on: boolean): void {
  if (process.platform === 'linux') {
    writeAutostart(on, linuxProgram());
    return;
  }
  app.setLoginItemSettings({ ...LOGON, openAtLogin: on });
}
