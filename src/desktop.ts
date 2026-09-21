/**
 * The FirstMate window and the notification-area icon above it.
 *
 * This is the part that shows. It owns the window, the icon and the two views,
 * and it is the only file in FirstMate that imports the webview library. It
 * imports it when the subcommand runs rather than when the module loads, so
 * that every other command keeps working on a machine where the native binary
 * is missing or will not load for want of system libraries (ADR-0011). The part
 * that decides is `desktop-state.ts`, and it imports nothing native.
 *
 * The window is a viewer and never a frame. The content view loads the Host's
 * own address and shows the bytes the Host serves; nothing is injected into a
 * Plugin Page, wrapped around it or read out of it (ADR-0008).
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BrowserWindow,
  MenuItemOptions,
  MenuOptions,
  TrayIcon,
  WebContext,
  Webview,
} from '@webviewjs/webview';
import {
  findTheHost,
  hasDesktop,
  indexAddress,
  NO_DESKTOP,
  pluginAddress,
  pluginOpenAt,
  restartTheHost,
  watchTheHost,
  type PluginSeen,
  type Plugins,
  type Pulse,
  type Where,
} from './desktop-state.ts';
import { STATE_WORDS } from './index-page.ts';
import { readLogon, setLogon } from './logon.ts';
import { nameTheWindow } from './taskbar.ts';
import { SCHEME, stripPage, THE_PLUGIN_LIST } from './strip.ts';

/** The window's title. The chrome strip names what is open inside it. */
const TITLE = 'FirstMate';

/** The window's first size. It is resizable, and it remembers nothing yet. */
const WIDTH = 1100;
const HEIGHT = 760;

/**
 * How tall the chrome strip is, in logical pixels.
 *
 * Bounds are logical, so the window's inner size is asked for in the same
 * coordinates and no scale factor is ever worked out by hand.
 */
const STRIP = 44;

/**
 * The mark for each state the Host can be in.
 *
 * The path is read from this module rather than from the working directory, so
 * it is `icons/` beside `src/` in a clone and `icons/` beside `dist/` in the
 * package, and neither needs a build step to put it there (ADR-0010).
 */
const MARKS: Readonly<Record<Pulse['state'], URL>> = {
  running: new URL('../icons/firstmate-running.ico', import.meta.url),
  stopped: new URL('../icons/firstmate-stopped.ico', import.meta.url),
};

/** What the menu items ask for. A Plugin's item carries its Plugin Name. */
const OPEN = 'open-firstmate';
const QUIT = 'quit';
const RESTART = 'restart-the-host';
const LOGON = 'start-at-logon';
const PLUGIN = 'plugin:';

/**
 * The window, the views in it, the icon, and the browser data they keep.
 *
 * All of it is held while the program runs. The library asks for a strong
 * reference to anything whose methods or listeners are still wanted, and says
 * the data must outlive every view that uses it.
 */
let shown:
  | {
      readonly window: BrowserWindow;
      readonly strip: Webview;
      readonly content: Webview;
      readonly context: WebContext;
      readonly tray: TrayIcon;
    }
  | undefined;

/**
 * Open the window on the Index Page, put FirstMate in the notification area,
 * and hold both until the program is told to quit.
 *
 * The distribution and the Host's home directory are worked out when they are
 * not given, so that the window opens with no address typed and no token
 * pasted.
 */
export async function openWindow(asked: Partial<Where>): Promise<number> {
  if (!hasDesktop(process.platform, process.env)) {
    console.error(`firstmate: ${NO_DESKTOP}`);
    return 1;
  }

  const found = await findTheHost(asked);
  if (found.kind === 'lost') {
    console.error(`firstmate: ${found.reason}`);
    return 1;
  }

  const webview = await load();
  const app = new webview.Application();
  const context = app.createWebContext({ dataDirectory: dataDirectory(process.env) });
  const mark = marks();

  // The window is made hidden and shown once it is right. Windows reads what a
  // window is when it makes its taskbar button, and a button already made keeps
  // what it read.
  const window = app.createBrowserWindow({
    title: TITLE,
    width: WIDTH,
    height: HEIGHT,
    visible: false,
  });
  if (mark.running !== undefined) {
    // Windows draws the title bar from the small icon and the taskbar from the
    // big one, and these are the two calls that set them. Setting one alone
    // leaves the other showing the icon of whatever runs the program, which is
    // node.exe.
    window.setWindowIcon(mark.running);
    window.setTaskbarIcon(mark.running);
  }

  // Asked for now and waited for later, so that the window is not held shut
  // while PowerShell starts.
  const naming = nameTheWindow(window.getNativeHandle(), MARKS.running);

  /** The run the window is talking to. A restart of the Host replaces it. */
  let run = found.runtime;
  /** The Plugin whose Plugin Page is open, if it is not the Index Page. */
  let open: string | undefined;
  /** What the strip says is open. */
  let named = THE_PLUGIN_LIST;

  const size = window.getInnerSize(true);

  // The strip is the program's own page. It asks for one thing, by trying to
  // go to one address, and this is where that address is refused and answered.
  const strip = window.createWebview({
    html: stripPage(THE_PLUGIN_LIST),
    x: 0,
    y: 0,
    width: size.width,
    height: STRIP,
    webContext: context,
    navigationHandler: (address) => {
      if (!address.startsWith(SCHEME)) return true;
      // A guard has to answer at once, so the work happens after it has.
      setTimeout(() => content.loadUrl(indexAddress(run)), 0);
      return false;
    },
  });

  // The content view is made with nothing in it, so that what it is showing is
  // known from its first navigation onwards. Nothing is ever injected into it,
  // wrapped around it or read out of it: the window is a viewer (ADR-0008).
  const content = window.createWebview({
    x: 0,
    y: STRIP,
    width: size.width,
    height: size.height - STRIP,
    webContext: context,
  });

  /** What went wrong with the last thing the person asked for, until they do
   *  something else. The strip is where the program says it. */
  let fault: string | undefined;

  /** Say the strip again. It is a small page the program owns every byte of,
   *  so it is written rather than reached into. */
  const redraw = (): void => {
    strip.loadHtml(stripPage(named, fault));
  };

  const complain = (said: string): void => {
    fault = said;
    redraw();
    // A failure the person asked for is worth showing them, even if they had
    // put the window away.
    window.setVisible(true);
  };

  content.on('navigation', (event) => {
    open = event.url === undefined ? undefined : pluginOpenAt(event.url);
    const now = open ?? THE_PLUGIN_LIST;
    const clearing = fault !== undefined;
    if (now === named && !clearing) return;
    named = now;
    fault = undefined;
    redraw();
  });

  // The library holds bounds rather than a layout, so they are put back every
  // time the window changes size.
  window.on('resize', () => {
    const now = window.getInnerSize(true);
    strip.setBounds({ x: 0, y: 0, width: now.width, height: STRIP });
    content.setBounds({
      x: 0,
      y: STRIP,
      width: now.width,
      height: Math.max(now.height - STRIP, 0),
    });
  });

  const tray = app.createTrayIcon({
    id: 'firstmate',
    ...(mark.running === undefined ? {} : { icon: { data: mark.running } }),
    tooltip: tooltip({ state: 'running', runtime: run, plugins: { kind: 'untold' } }),
    menu: menu({ plugins: { kind: 'untold' }, running: true, logon: readLogon(process.env).on }),
    // A click opens the window, which is the thing wanted nearly every time.
    // The menu is where the rest lives, one click to the right of it.
    menuOnLeftClick: false,
    menuOnRightClick: true,
  });

  // Closing the window hides it rather than ending the program, because the
  // icon is still there and the program is still reachable from it. Quit is
  // what ends FirstMate.
  //
  // The close is refused rather than allowed, and the window is hidden by hand.
  // Letting it through ends the application, and the application owns the icon:
  // it disposes it, and the next poll then talks to an icon that is gone.
  window.on('close', (event) => {
    event.preventDefault();
    window.setVisible(false);
  });

  let quit: () => void = () => {};
  const ending = new Promise<void>((done) => {
    quit = done;
  });

  tray.on('click', () => window.setVisible(true));
  app.on('custom-menu-click', (event) => {
    // A click that throws must not end the program. This is the handler the
    // Tray died in (#44), and a Plugin clicked one moment after the Host took
    // it away is exactly the click that would do it.
    try {
      const asked = event.customMenuEvent?.id;
      if (asked === OPEN) {
        window.setVisible(true);
      } else if (asked === QUIT) {
        quit();
      } else if (asked === RESTART) {
        void restartTheHost(found.where).then((why) => {
          if (why !== undefined) complain(`FirstMate could not start the Host: ${why}`);
        });
      } else if (asked === LOGON) {
        const on = !readLogon(process.env).on;
        const why = setLogon(process.env, on, logonCommand(found.where));
        if (why !== undefined) complain(why);
        else listed = '';
      } else if (asked !== undefined && asked.startsWith(PLUGIN)) {
        content.loadUrl(pluginAddress(run, asked.slice(PLUGIN.length)));
        window.setVisible(true);
      }
    } catch (fault: unknown) {
      const said = fault instanceof Error ? fault.message : String(fault);
      console.error(`firstmate: that menu click went nowhere: ${said}`);
    }
  });

  /** What the menu was last built from. Rebuilding it unchanged is churn. */
  let listed = '';

  const stopWatching = watchTheHost(found.where, run, (pulse) => {
    // The icon goes when the application goes, and a beat already in flight
    // would otherwise reach for one that is no longer there.
    if (tray.isDisposed()) return;
    const now = mark[pulse.state];
    if (now !== undefined) tray.setIcon(now);
    tray.setTooltip(tooltip(pulse));

    const view: MenuView = {
      plugins: pulse.plugins,
      running: pulse.state === 'running',
      logon: readLogon(process.env).on,
    };
    const said = signature(view);
    if (said !== listed) {
      listed = said;
      tray.setMenu(menu(view));
    }

    if (pulse.runtime === undefined) return;
    if (pulse.runtime.port === run.port && pulse.runtime.token === run.token) return;

    // The Host was replaced underneath the window. The new run answers at a new
    // address, so the view goes back to where it already was, at that address.
    run = pulse.runtime;
    content.loadUrl(open === undefined ? indexAddress(run) : pluginAddress(run, open));
  });

  shown = { window, strip, content, context, tray };
  content.loadUrl(indexAddress(run));
  app.run();

  const unnamed = await naming;
  if (unnamed !== undefined) {
    // A taskbar button wearing Node's icon is a blemish and not a fault.
    console.error(`firstmate: the taskbar button keeps the icon of whatever ran it: ${unnamed}`);
  }
  window.setVisible(true);

  await ending;

  stopWatching();
  shown = undefined;
  try {
    app.exit();
  } catch {
    // It is already going. There is nothing to add.
  }
  return 0;
}

/**
 * The icon's menu.
 *
 * The Plugins are a submenu rather than a run of items, so that Quit never
 * moves under the cursor when a Plugin is added or taken away.
 */
function menu(view: MenuView): MenuOptions {
  return {
    items: [
      { id: OPEN, label: 'Open FirstMate' },
      { label: 'Plugins', submenu: { items: pluginItems(view.plugins) } },
      // The label says what will happen, not what the item is for. One command
      // does both, because a restart starts a unit that is not running.
      { id: RESTART, label: view.running ? 'Restart FirstMate' : 'Start FirstMate' },
      { id: LOGON, label: view.logon ? 'Start at logon \u2713' : 'Start at logon' },
      { id: QUIT, label: 'Quit' },
    ],
  };
}

/** Everything the menu has to be right about. */
type MenuView = {
  readonly plugins: Plugins;
  readonly running: boolean;
  readonly logon: boolean;
};

/**
 * Every Plugin, or the one sentence that stands in for the list.
 *
 * A Host that would not say and a Registry with nothing in it get different
 * sentences, because they are different states. The first is not an empty
 * list, and saying so was what took the Tray down (#44).
 */
function pluginItems(plugins: Plugins): MenuItemOptions[] {
  if (plugins.kind === 'untold') {
    return [{ id: 'plugins-untold', label: 'The Host would not say', enabled: false }];
  }
  if (plugins.plugins.length === 0) {
    return [{ id: 'plugins-none', label: 'No Plugin is registered', enabled: false }];
  }
  return plugins.plugins.map((plugin) => ({
    id: `${PLUGIN}${plugin.name}`,
    label: pluginLabel(plugin),
    // A Plugin that ships no Plugin Page has no address to open, so it is shown
    // and not offered. A Stopped Plugin is still offered: the Host serves its
    // page whatever its Plugin Server is doing, and a broken Plugin must stay
    // visible rather than vanish.
    enabled: plugin.hasPage,
  }));
}

function pluginLabel(plugin: PluginSeen): string {
  return plugin.state === 'running'
    ? plugin.name
    : `${plugin.name} — ${STATE_WORDS[plugin.state]}`;
}

/** What a menu is built from, as one string, so that an unchanged menu is
 *  built once. */
function signature(view: MenuView): string {
  const listed =
    view.plugins.kind === 'untold'
      ? 'untold'
      : view.plugins.plugins.map((p) => `${p.name}/${p.hasPage}/${p.state}`).join(',');
  return `${listed}|${view.running}|${view.logon}`;
}

/**
 * The command that starts FirstMate at logon.
 *
 * It is what is running now, with the distribution and the Host's home already
 * worked out, so that the logon entry never has to work them out again on a
 * machine that may be half awake.
 */
function logonCommand(where: Where): readonly string[] {
  return [
    process.execPath,
    // The command line this program was started from, which is what the logon
    // entry has to start again.
    process.argv[1] ?? '',
    'desktop',
    '--distribution',
    where.distribution,
    '--home',
    where.home,
  ];
}

/** What the icon says when the pointer rests on it. */
function tooltip(pulse: Pulse): string {
  return pulse.runtime === undefined || pulse.state === 'stopped'
    ? 'FirstMate: the Host is stopped'
    : `FirstMate: the Host is running on ${pulse.runtime.port}`;
}

/** Both marks, or neither. A mark that cannot be read costs the icon and not
 *  the program, and it is surprising enough to say once. */
function marks(): { readonly running?: Buffer; readonly stopped?: Buffer } {
  try {
    return { running: readFileSync(MARKS.running), stopped: readFileSync(MARKS.stopped) };
  } catch (fault: unknown) {
    const said = fault instanceof Error ? fault.message : String(fault);
    console.error(`firstmate: the window and the icon go without their mark: ${said}`);
    return {};
  }
}

/**
 * Where the window's browser engine keeps its own data.
 *
 * It puts that data beside the program hosting it unless it is told otherwise,
 * and the program hosting it is node.exe inside Program Files, which it may not
 * write to. Without this the window does not open at all: it fails with an
 * access denied, and the library's own note says a data directory is the answer.
 *
 * Nothing of FirstMate's lives here. It is a browser profile, holding a cache
 * and the cookie the Host admits this window with, which the Host mints again
 * every time it starts.
 */
function dataDirectory(env: NodeJS.ProcessEnv): string {
  const local = env['LOCALAPPDATA'];
  return join(local === undefined || local === '' ? tmpdir() : local, 'FirstMate', 'Window');
}

/**
 * The webview library, loaded now rather than when this module was read.
 *
 * Its own message for a binary that will not load blames npm for a bug with
 * optional dependencies, which on a machine short of WebKit is the wrong thing
 * to go and read. The first line of it is kept, and the sentence around it says
 * what is true of FirstMate.
 */
async function load(): Promise<typeof import('@webviewjs/webview')> {
  try {
    return await import('@webviewjs/webview');
  } catch (fault: unknown) {
    const said = fault instanceof Error ? fault.message : String(fault);
    throw new Error(
      `The FirstMate window could not load the library it draws with: ` +
        `${said.split('\n')[0] ?? said}\n` +
        `Every other FirstMate command works without it.`,
    );
  }
}
