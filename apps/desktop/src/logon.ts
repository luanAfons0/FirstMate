/**
 * Start at logon, as the App reads and writes it: the Run entry `setup` writes
 * too (ADR-0024), so each sees what the other wrote.
 *
 * The Tray and the Settings View both turn it on and off, and both read it
 * here, so neither keeps an answer of its own that the other could leave
 * wrong. It is off until the operator turns it on.
 */
import { app } from 'electron';
import { AT_LOGON, LOGON_NAME } from '@firstmate/core/logon';

/**
 * The logon entry, named as `setup` names it. Electron would name it after the
 * Application User Model ID, and then neither would find the other's entry.
 */
const LOGON = { name: LOGON_NAME, path: process.execPath, args: [AT_LOGON] };

/** Whether the App starts at logon. */
export function readLogon(): boolean {
  return app.getLoginItemSettings(LOGON).openAtLogin;
}

/** Turn start at logon on or off. */
export function writeLogon(on: boolean): void {
  app.setLoginItemSettings({ ...LOGON, openAtLogin: on });
}
