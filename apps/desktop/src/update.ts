/**
 * The App keeps itself up to date: it downloads an update in the background,
 * says so with one Notice when it is ready, and installs it when the App
 * quits, never in the middle of work.
 *
 * electron-updater reads the feed packaging wrote, `latest.yml` on the
 * GitHub Release, and finds the App's channel from the App's own version: a
 * stable App follows the latest stable Release, and a beta follows the newest
 * Release of either kind (ADR-0023). Nothing here names a channel.
 *
 * On Linux the App updates itself only as an AppImage, whose runtime names
 * the file in `APPIMAGE`. A deb is the package manager's to update
 * (ADR-0026), and electron-updater would otherwise ask for root to install
 * one, so a deb looks for nothing.
 *
 * The first look waits a few minutes after the App starts. Starting is when
 * every Plugin Server starts too, and an App started only to be looked at, as
 * the smoke test starts one, has quit long before then and downloads nothing.
 */
import { app } from 'electron';
import type { AppUpdater as AutoUpdater } from 'electron-updater';

/** How long after the App starts it first looks for an update. */
const FIRST_LOOK_MS = 5 * 60 * 1000;

/** How often it looks again, for an App that runs for days. */
const LOOK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Look for updates in the background from now on. `say` shows one Notice
 * when an update has downloaded. An App that is not packaged, run from a
 * clone, has no feed to follow and looks for nothing, and neither does a deb.
 */
export function keepUpdated(say: (sentence: string) => void): void {
  if (!updatesItself()) return;
  // Loaded at the first look, so starting the App does not evaluate the
  // updater. The bundle still carries it, as a chunk of its own (ADR-0020).
  let started: Promise<AutoUpdater> | undefined;
  const updater = (): Promise<AutoUpdater> => {
    started ??= prepare(say);
    return started;
  };
  const look = (): void => {
    updater()
      .then((autoUpdater) => autoUpdater.checkForUpdates())
      .catch(() => undefined);
  };
  setTimeout(look, FIRST_LOOK_MS).unref();
  setInterval(look, LOOK_EVERY_MS).unref();
}

/** Whether this App is one electron-updater may update: packaged, and not a deb. */
function updatesItself(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform !== 'linux') return true;
  const appImage = process.env['APPIMAGE'];
  return appImage !== undefined && appImage !== '';
}

/** Load electron-updater and set it up, once. */
async function prepare(say: (sentence: string) => void): Promise<AutoUpdater> {
  const { default: electronUpdater } = await import('electron-updater');
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  // Installed when the App quits, so a Plugin Server is never stopped for it.
  autoUpdater.autoInstallOnAppQuit = true;
  // The updater's own output goes to the Host's log with everything else.
  autoUpdater.logger = console;

  autoUpdater.on('update-downloaded', (update) => {
    say(`FirstMate ${update.version} is ready. It installs when you quit FirstMate.`);
  });
  autoUpdater.on('error', (fault) => {
    // A missed look is no news: the next one comes in a few hours.
    console.error(`FirstMate: could not look for an update: ${fault.message}`);
  });
  return autoUpdater;
}
