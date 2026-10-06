/**
 * How the App starts at logon: one entry in the Windows Run key, named
 * FirstMate, that starts the App with one argument.
 *
 * The App sets it from the Tray and the Settings View, and `setup` sets it
 * from a terminal, so both write the same entry and each sees what the other
 * wrote (ADR-0024). It is off until the operator turns it on.
 */

/** The Run key every logon entry of this user is a value of. */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** The name of the App's logon entry. */
export const LOGON_NAME = 'FirstMate';

/** The argument the logon entry starts the App with, so it begins in the Tray. */
export const AT_LOGON = '--at-logon';
