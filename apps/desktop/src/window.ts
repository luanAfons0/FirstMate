/**
 * The window: the strip above, and below it one view for the Index Page and
 * one for each Plugin Page the operator has opened.
 *
 * Each Plugin Page has a view of its own, with no preload and the sandbox on,
 * and it stays loaded until the App quits, so a Plugin Page the operator
 * switches away from keeps its state, and a call it records keeps recording.
 * The window shows one view at a time and never reaches inside one: nothing is
 * injected into a Plugin Page, wrapped around it or read out of it (ADR-0008).
 *
 * The strip, the switcher and the Settings View are the App's own views, with
 * pages the App writes (`pages.ts`). They are the only views that carry the
 * preload, so they are the only pages that can ask the main process for
 * anything, and the main process checks which view asked. A Plugin Page cannot
 * reach them, and it cannot reach another Plugin's view: a link to another
 * Plugin's address is refused in its own view and opened in the other one.
 *
 * The window shows the Host and nothing else. A link to anywhere else, in a new
 * window or the same one, opens in the operator's own browser.
 */
import { fileURLToPath } from 'node:url';
import { BaseWindow, ipcMain, shell, WebContentsView, type IpcMainEvent } from 'electron';
import {
  admitted,
  browserAddress,
  INDEX,
  isOwnStart,
  leavesTheHost,
  onHost,
  ownerOf,
  pathOf,
  pluginPath,
  type HostAt,
} from './addresses.ts';
import { ASK_CHANNEL, readAsked, type Asked } from './ask.ts';
import type { Plugins } from './host-lists.ts';
import {
  dataAddress,
  settingsPage,
  STRIP_HEIGHT,
  stripPage,
  SWITCHER_LEFT,
  SWITCHER_WIDTH,
  switcherHeight,
  switcherPage,
  type Here,
} from './pages.ts';

/** The window's title. The strip names what is open inside it. */
const TITLE = 'FirstMate';

/** The window's first size, in logical pixels. */
const WIDTH = 1100;
const HEIGHT = 760;

/** The preload the App's own views carry, and no other view. */
const PRELOAD = fileURLToPath(new URL('../preload/app.cjs', import.meta.url));

/** The window, and what the rest of the App asks of it. */
export type Shown = {
  /** The window itself, for a dialog to belong to. */
  readonly window: BaseWindow;
  /**
   * Show one address of the Host in the view of whoever owns it. A view that
   * is already open on its own first page is shown as it is, not loaded again.
   */
  open(path: string): void;
  /** Bring the window up, as it was. */
  reveal(): void;
  /** What the Host now says about its Plugins. */
  told(plugins: Plugins): void;
};

/**
 * Open the window on the Index Page. `refresh` asks the Host for its Plugins
 * again; the answer comes back through `told`.
 */
export function openWindow(host: HostAt, refresh: () => void): Shown {
  const window = new BaseWindow({
    title: TITLE,
    width: WIDTH,
    height: HEIGHT,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#17181a',
    show: false,
  });

  /** The owner whose view is shown: a Plugin Name, or `INDEX`. */
  let current = INDEX;
  /** Whether the switcher is open, below the breadcrumb and over the page. */
  let switching = false;
  /** Whether the Settings View is shown in place of the content views. */
  let setting = false;
  /** What went wrong with the last thing asked for, until the next one. */
  let fault: string | undefined;
  /** Every Plugin the Host last named, in the Plugin Order. */
  let plugins: Plugins = { kind: 'untold' };
  /** One view for each owner the operator has opened. */
  const contents = new Map<string, WebContentsView>();

  // The order of the children is the order they are drawn in: the strip, the
  // content views, the Settings View, and the switcher on top of them all.
  const strip = appView();
  const settings = appView();
  const switcher = appView();
  window.contentView.addChildView(strip);
  window.contentView.addChildView(settings);
  window.contentView.addChildView(switcher);

  /** What each App view last said. A page that says the same thing again is
   *  not loaded again: loading it would lose the focus in it. */
  let stripSaid = '';
  let switcherSaid = '';
  let settingsSaid = '';

  const here = (): Here => {
    if (setting) return { kind: 'settings' };
    return current === INDEX ? { kind: 'list' } : { kind: 'plugin', name: current };
  };

  const layout = (): void => {
    const [width = 0, height = 0] = window.getContentSize();
    const below = { x: 0, y: STRIP_HEIGHT, width, height: Math.max(height - STRIP_HEIGHT, 0) };
    strip.setBounds({ x: 0, y: 0, width, height: STRIP_HEIGHT });
    for (const [owner, view] of contents) {
      view.setBounds(below);
      view.setVisible(!setting && owner === current);
    }
    settings.setBounds(below);
    settings.setVisible(setting);
    switcher.setBounds({
      x: SWITCHER_LEFT,
      y: STRIP_HEIGHT,
      width: Math.max(Math.min(SWITCHER_WIDTH, width - 2 * SWITCHER_LEFT), 0),
      height: Math.max(Math.min(switcherHeight(plugins), height - STRIP_HEIGHT - SWITCHER_LEFT), 0),
    });
    switcher.setVisible(switching);
  };

  const redraw = (): void => {
    const said = stripPage({ here: here(), switcher: switching, fault });
    if (said !== stripSaid) {
      stripSaid = said;
      loadPage(strip, said);
    }
    if (switching) {
      const list = switcherPage(current === INDEX ? undefined : current, plugins);
      if (list !== switcherSaid) {
        switcherSaid = list;
        loadPage(switcher, list);
      }
    }
    if (setting && settingsSaid === '') {
      settingsSaid = settingsPage();
      loadPage(settings, settingsSaid);
    }
    layout();
  };

  const reveal = (): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const complain = (said: string): void => {
    fault = said;
    redraw();
    reveal();
  };

  /** Give a link off the Host to the system browser, and say so if Windows
   *  would not take it. The address is not said: it may carry anything. */
  const toBrowser = (address: string): void => {
    openOutside(address).catch(() => complain('The system browser would not open that link.'));
  };

  /** A view for one owner, made the first time the operator opens it. */
  const contentView = (owner: string): WebContentsView => {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // A Plugin Page the operator cannot see still runs at full speed:
        // a page that records or counts must not slow down when hidden.
        backgroundThrottling: false,
      },
    });
    // Above the strip and below the Settings View and the switcher.
    window.contentView.addChildView(view, 1);
    const page = view.webContents;
    page.on('will-navigate', (event, url) => {
      if (leavesTheHost(host, url)) {
        event.preventDefault();
        toBrowser(url);
        return;
      }
      const there = ownerOf(host, url);
      if (there === owner || url === 'about:blank') return;
      // Another owner's address opens in that owner's view, so one Plugin's
      // view never shows another Plugin's page. Anything that is neither
      // the Host nor the web is refused.
      event.preventDefault();
      if (there !== undefined) setImmediate(() => open(pathOf(url), 'as-it-is'));
    });
    page.setWindowOpenHandler(({ url }) => {
      if (leavesTheHost(host, url)) toBrowser(url);
      else if (ownerOf(host, url) !== undefined) setImmediate(() => open(pathOf(url), 'as-it-is'));
      return { action: 'deny' };
    });
    contents.set(owner, view);
    return view;
  };

  /**
   * The first load carries the token, and the Host trades it for the cookie
   * every view shares. Every later load waits for that trade and carries no
   * token, so no Plugin Page ever finds the token in its own address.
   */
  let admission: Promise<void> | undefined;
  const loadContent = (view: WebContentsView, path: string): void => {
    const first = admission === undefined;
    const loading = (admission ?? Promise.resolve()).then(() =>
      view.webContents.loadURL(first ? admitted(host, path) : onHost(host, path)),
    );
    // An error from loadURL names the address, and the first one carries the
    // token, so only the code is said.
    const said = loading.catch((failed: unknown) => {
      const code = failed instanceof Error && 'code' in failed ? String(failed.code) : 'no code';
      if (code !== 'ERR_ABORTED') console.error(`FirstMate: a view did not load (${code}).`);
    });
    admission ??= said;
  };

  /**
   * Show one owner's view. It is made and loaded the first time. After that,
   * the operator's own `load` loads the address asked for, unless it is the
   * view's own first page; a link on a page shows the view `as-it-is`, so
   * one Plugin's page can never reload another Plugin's view and lose what
   * it holds.
   */
  const open = (path: string, how: 'load' | 'as-it-is' = 'load'): void => {
    const owner = ownerOf(host, path) ?? INDEX;
    const known = contents.get(owner);
    const view = known ?? contentView(owner);
    // The Index Page is the Host's own and keeps nothing, so it is loaded
    // again each time, to show the Plugins as they are now.
    const again = how === 'load' && !isOwnStart(owner, path);
    if (known === undefined || owner === INDEX || again) loadContent(view, path);
    current = owner;
    setting = false;
    switching = false;
    fault = undefined;
    redraw();
    view.webContents.focus();
  };

  /** The Plugin of this name, as the Host last named it. */
  const named = (name: string) =>
    plugins.kind === 'told' ? plugins.plugins.find((plugin) => plugin.name === name) : undefined;

  const act = (asked: Asked): void => {
    if (asked.kind === 'plugin-list') {
      open('/');
    } else if (asked.kind === 'open-in-browser') {
      const shown = setting ? undefined : contents.get(current)?.webContents.getURL();
      openOutside(browserAddress(host, shown)).catch(() =>
        complain('The system browser would not open this page.'),
      );
    } else if (asked.kind === 'switcher' || asked.kind === 'switcher-close') {
      switching = asked.kind === 'switcher' && !switching;
      // Written again on every open, so that its script puts the focus on
      // the open Plugin each time.
      switcherSaid = '';
      if (switching) refresh();
      redraw();
      if (switching) switcher.webContents.focus();
    } else if (asked.kind === 'open') {
      if (named(asked.name)?.hasPage === true) {
        open(pluginPath(asked.name));
      } else {
        switching = false;
        redraw();
      }
    } else if (asked.kind === 'settings') {
      setting = !setting;
      switching = false;
      fault = undefined;
      redraw();
      if (setting) settings.webContents.focus();
    }
  };

  const ask = (event: IpcMainEvent, said: unknown): void => {
    // Only the App's own views carry the preload. The check is here as well,
    // so that the rule does not rest on the preload alone.
    const own = [strip, switcher, settings].some((view) => view.webContents === event.sender);
    if (own) act(readAsked(said));
  };
  ipcMain.on(ASK_CHANNEL, ask);

  window.on('resize', layout);
  window.on('maximize', layout);
  window.on('unmaximize', layout);
  window.on('restore', layout);
  window.on('closed', () => {
    ipcMain.off(ASK_CHANNEL, ask);
    for (const view of [strip, switcher, settings, ...contents.values()]) {
      view.webContents.close();
    }
  });

  open('/');
  window.show();

  return {
    window,
    open: (path) => {
      open(path);
      reveal();
    },
    reveal,
    told: (now) => {
      plugins = now;
      if (now.kind === 'told') {
        // A Plugin the Host no longer names has no page to keep.
        for (const [owner, view] of contents) {
          if (owner === INDEX || now.plugins.some((plugin) => plugin.name === owner)) continue;
          contents.delete(owner);
          window.contentView.removeChildView(view);
          view.webContents.close();
          if (owner === current) open('/');
        }
      }
      redraw();
    },
  };
}

/**
 * A view for one of the App's own pages. It carries the preload, it never
 * navigates, and it opens nothing.
 */
function appView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  });
  view.webContents.on('will-navigate', (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return view;
}

function loadPage(view: WebContentsView, html: string): void {
  // A page written again before the last one loaded aborts it; that is not
  // a fault.
  view.webContents.loadURL(dataAddress(html)).catch(() => undefined);
}

/** Open an address in the operator's browser, when it is one a browser opens. */
function openOutside(address: string): Promise<void> {
  const protocol = URL.parse(address)?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
    return Promise.resolve();
  }
  return shell.openExternal(address);
}
