/**
 * The App: the Host in its main process, and one window on the Index Page.
 *
 * The App is the one program a person installs on Windows or Linux
 * (ADR-0020, ADR-0026). It starts the Host as `node packages/host/src/main.ts`
 * does, with the same home, the same port and the same runtime file, so that
 * the command line and every test reach it the same way. Quit stops the Host through the same
 * `stop()` a signal reaches, so no Plugin Server outlives the App.
 *
 * The window and the Tray show as soon as Electron is ready, before the Host
 * has started every Plugin Server, and the Index Page loads when the Host is
 * ready. The Host itself starts as it always did. A Host that does not start,
 * such as on a port that is taken, still ends the App with one sentence.
 *
 * Only one App runs for one home. A second start shows the first window and
 * ends; it never starts a second Host.
 *
 * This file only wires the parts together. The window and its views are
 * `window.ts`, the Tray is `tray.ts`, Notices are `notices.ts`, and the
 * Shortcuts and their Popup are `shortcuts.ts` and `popup.ts`, and what a
 * Plugin Page may use of the machine is `permissions.ts`, and updates are
 * `update.ts`. Closing the window hides it; Quit, from the Tray, ends the App.
 */
import { join } from 'node:path';
import { app, dialog, Menu } from 'electron';
import { readConfig, type Config } from '@firstmate/core/config';
import { AT_LOGON } from '@firstmate/core/logon';
import { flushLog } from '@firstmate/host/log';
import type { Notice } from '@firstmate/host/notices';
import { start, type RunningHost } from '@firstmate/host/start';
import { askForPlugins, askForShortcuts, askToRestart } from './host-lists.ts';
import { nameTheApp, showNotices } from './notices.ts';
import { guardPermissions } from './permissions.ts';
import { makePopup } from './popup.ts';
import { holdShortcuts } from './shortcuts.ts';
import { holdTray, type HeldTray } from './tray.ts';
import { keepUpdated } from './update.ts';
import { openWindow, type Shown } from './window.ts';

/** The window's title, and the name every sentence the App says is signed with. */
const NAME = 'FirstMate';

main();

function main(): void {
  holdShortcutsUnderWayland();
  const config = configOrSay();
  if (config === undefined) return;

  // Electron keeps its own data, and its single-instance lock, under the
  // home rather than beside the Registry's in %APPDATA%\FirstMate itself. A
  // test that moves the home then moves the lock too, and never meets the
  // App the operator runs.
  app.setPath('userData', join(config.home, 'app'));
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let shown: Shown | undefined;
  let tray: HeldTray | undefined;
  app.on('second-instance', () => shown?.reveal());

  nameTheApp();

  // What the Host says about its Plugins is asked again whenever it may have
  // changed, and the window and the Tray are both told the answer.
  let refresh = (): void => {};
  // The Shortcuts are read again after the same changes, so a reload picks
  // up a bind or an unbind.
  let reread = (): void => {};
  // A Notice the Host takes while it starts, such as a Plugin that would not
  // start, waits until the App can show it.
  const early: Notice[] = [];
  let notify = (notice: Notice): void => {
    early.push(notice);
  };
  const host = start(config, {
    onChange: () => {
      refresh();
      reread();
    },
    onNotice: (notice) => notify(notice),
  });
  stopOnQuit(host);

  // The window, the strip and the Tray show as soon as Electron is ready,
  // while the Host still starts every Plugin Server. The rest needs the Host.
  const made = app.whenReady().then(() => {
    // The Index Page and each Plugin Page are whole pages, so the window
    // adds no menu of its own above them (ADR-0008).
    Menu.setApplicationMenu(null);
    const notices = showNotices((path) => shown?.open(path));
    // Started at logon, the App begins in the Tray with the window put away.
    const window = openWindow(() => refresh(), process.argv.includes(AT_LOGON), {
      home: config.home,
      // A change made while the Host starts waits for it to be ready.
      reload: () => host.then((running) => running.reload()),
    });
    shown = window;
    tray = holdTray({
      open: (path) => window.open(path),
      reveal: () => window.reveal(),
      changed: () => refresh(),
      settings: () => window.showSettings(),
      restart: (name) => {
        // Before the Host is ready there is no Plugin Server to start again.
        void host.then(async (running) => {
          const failed = await askToRestart(running, name);
          if (failed !== undefined) notices.say(failed);
          refresh();
        });
      },
    });
    notify = (notice) => notices.show(notice);
    for (const notice of early.splice(0)) notices.show(notice);
    return { window, notices };
  });

  Promise.all([host, made]).then(
    ([running, { window, notices }]) => {
      refresh = () => {
        void askForPlugins(running).then((plugins) => {
          shown?.told(plugins);
          tray?.told(plugins);
        });
      };
      // Every permission is settled before the first page of the Host loads.
      // Only the App's own pages are loaded before it, and they ask for none.
      guardPermissions({
        host: running,
        home: config.home,
        window: () => shown?.window,
        say: (sentence) => notices.say(sentence),
      });
      window.ready(running);
      const popup = makePopup({
        host: running,
        admitted: () => window.admitted(),
        toBrowser: (address) => window.toBrowser(address),
      });
      const shortcuts = holdShortcuts({
        // A Shortcut pressed again puts its own Popup away.
        pressed: (keys, address) => {
          if (popup.shownBy() === keys) popup.hideIfOpenedBy(keys);
          else popup.show(keys, address);
        },
        released: (keys) => popup.hideIfOpenedBy(keys),
        say: (sentence) => notices.say(sentence),
      });
      reread = () => {
        void askForShortcuts(running).then((now) => shortcuts.hold(now));
      };
      refresh();
      reread();
      keepUpdated((sentence) => notices.say(sentence));
    },
    (fault: unknown) => {
      // The Host did not start, and it has already ended what it started.
      // The App says why in one sentence and does not start either, even
      // when its window already shows.
      say(fault instanceof Error ? fault.message : String(fault));
      exit(1);
    },
  );
}

/**
 * Under Wayland a program holds no key of the whole desktop by itself: it
 * asks the desktop's portal for its Shortcuts. Electron asks only with this
 * feature on, and only if it is on before the App is ready. X11 needs
 * nothing, and ignores it (ADR-0026).
 */
function holdShortcutsUnderWayland(): void {
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
  }
}

/** The Config, or nothing once the App has said why it cannot read one. */
function configOrSay(): Config | undefined {
  try {
    return readConfig();
  } catch (fault) {
    say(fault instanceof Error ? fault.message : String(fault));
    app.exit(1);
    return undefined;
  }
}

/**
 * Stop the Host before the App ends. Quit waits for every Plugin Server to
 * end, and the App then exits itself, which quits without asking again.
 */
function stopOnQuit(host: Promise<RunningHost>): void {
  let stopping = false;
  app.on('will-quit', (event) => {
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    host
      .then((running) => running.stop())
      .then(
        () => exit(0),
        // A Host that never started has nothing to stop; one that did not
        // stop cleanly still ends with the App, and says it failed.
        (fault: unknown) => {
          console.error(`${NAME}: the Host did not stop cleanly.`, fault);
          exit(1);
        },
      );
  });
}

/**
 * End the App now. The log holds its writes for a tick, and `app.exit` waits
 * for none, so what it still holds is written first (ADR-0022).
 */
function exit(code: number): void {
  flushLog();
  app.exit(code);
}

/** One sentence in a box, for a person with no terminal to read it in. */
function say(sentence: string): void {
  console.error(`${NAME}: ${sentence}`);
  dialog.showErrorBox(NAME, sentence);
}
