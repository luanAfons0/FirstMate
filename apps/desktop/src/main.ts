/**
 * The App: the Host in its main process, and one window on the Index Page.
 *
 * The App is the one program a person installs on Windows (ADR-0020). It
 * starts the Host as `node packages/host/src/main.ts` does, with the same
 * home, the same port and the same runtime file, so that the command line and
 * every test reach it the same way. Quit stops the Host through the same
 * `stop()` a signal reaches, so no Plugin Server outlives the App.
 *
 * Only one App runs for one home. A second start shows the first window and
 * ends; it never starts a second Host.
 */
import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell, type WebContents } from 'electron';
import { readConfig, type Config } from '@firstmate/core/config';
import { start, type RunningHost } from '@firstmate/host/start';

/** The window's title, and the name every sentence the App says is signed with. */
const NAME = 'FirstMate';

main();

function main(): void {
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

  let window: BrowserWindow | undefined;
  app.on('second-instance', () => {
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  // There is no Tray yet, so the window is the App: closing it quits.
  app.on('window-all-closed', () => app.quit());

  const host = start(config);
  stopOnQuit(host);

  Promise.all([host, app.whenReady()]).then(
    ([running]) => {
      window = openWindow(running);
    },
    (fault: unknown) => {
      // The Host did not start, and it has already ended what it started.
      // The App says why in one sentence and does not start either.
      say(fault instanceof Error ? fault.message : String(fault));
      app.exit(1);
    },
  );
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
        () => app.exit(0),
        // A Host that never started has nothing to stop; one that did not
        // stop cleanly still ends with the App, and says it failed.
        (fault: unknown) => {
          console.error(`${NAME}: the Host did not stop cleanly.`, fault);
          app.exit(1);
        },
      );
  });
}

/** One sentence in a box, for a person with no terminal to read it in. */
function say(sentence: string): void {
  console.error(`${NAME}: ${sentence}`);
  dialog.showErrorBox(NAME, sentence);
}

/** The window, on the Index Page, admitted by the token as a browser is. */
function openWindow(host: RunningHost): BrowserWindow {
  const origin = `http://127.0.0.1:${host.port}`;
  // The Index Page and each Plugin Page are whole pages, so the window adds
  // no menu of its own above them (ADR-0008).
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    title: NAME,
    width: 1100,
    height: 760,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  keepInside(window.webContents, origin);
  // The address carries the token, and an error from loadURL names the
  // address, so only its code is said.
  window.loadURL(`${origin}/?token=${host.token}`).catch((fault: unknown) => {
    const code = fault instanceof Error && 'code' in fault ? String(fault.code) : 'no code';
    console.error(`${NAME}: the window did not load the Index Page (${code}).`);
  });
  return window;
}

/**
 * Keep the window on the Host's own addresses. A link to anywhere else opens
 * in the operator's browser, because a window with no way back is no use, and
 * no page outside the Host is shown with the App's name on it.
 */
function keepInside(contents: WebContents, origin: string): void {
  const inside = (url: string): boolean => URL.parse(url)?.origin === origin;
  contents.on('will-navigate', (event, url) => {
    if (inside(url)) return;
    event.preventDefault();
    outside(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (inside(url)) contents.loadURL(url).catch(() => undefined);
    else outside(url);
    return { action: 'deny' };
  });
}

/** Open an address in the operator's browser, when it is one a browser opens. */
function outside(url: string): void {
  const protocol = URL.parse(url)?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return;
  shell.openExternal(url).catch((fault: unknown) => {
    console.error(`${NAME}: the browser did not open ${url}.`, fault);
  });
}
