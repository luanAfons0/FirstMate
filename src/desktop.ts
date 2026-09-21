/**
 * The FirstMate window: one view, showing the Index Page.
 *
 * This is the part that shows. It owns the window, and it is the only file in
 * FirstMate that imports the webview library. It imports it when the subcommand
 * runs rather than when the module loads, so that every other command keeps
 * working on a machine where the native binary is missing or will not load for
 * want of system libraries (ADR-0011). The part that decides is
 * `desktop-state.ts`, and it imports nothing native.
 *
 * The window is a viewer and never a frame. The view loads the Host's own
 * address and shows the bytes the Host serves, and nothing is injected into a
 * Plugin Page, wrapped around it or rewritten in it (ADR-0008).
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContext, Webview } from '@webviewjs/webview';
import {
  findTheHost,
  hasDesktop,
  indexAddress,
  NO_DESKTOP,
  pluginOpenAt,
  type Where,
} from './desktop-state.ts';
import { SCHEME, stripPage, THE_PLUGIN_LIST } from './strip.ts';

/** The window's title. A Plugin Page names itself in the chrome strip, later. */
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
 * The mark the window wears, in its title bar and on the taskbar.
 *
 * It is the running one because the window opens only where the Host is
 * running. The pair belongs to the notification-area icon, which shows a state
 * this window cannot be in.
 *
 * The path is read from this module rather than from the working directory, so
 * it is `icons/` beside `src/` in a clone and `icons/` beside `dist/` in the
 * package, and neither needs a build step to put it there (ADR-0010).
 */
const ICON = new URL('../icons/firstmate-running.ico', import.meta.url);

/**
 * The window, the two views in it, and the browser data they keep.
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
    }
  | undefined;

/**
 * Open the window on the Index Page, and hold it open.
 *
 * The distribution and the Host's home directory are worked out when they are
 * not given, so that the window opens with no address typed and no token
 * pasted. This returns when the window is closed.
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
  const mark = icon();
  const window = app.createBrowserWindow({ title: TITLE, width: WIDTH, height: HEIGHT });
  if (mark !== undefined) {
    // Windows draws the title bar from the small icon and the taskbar from the
    // big one, and these are the two calls that set them. Setting one alone
    // leaves the other showing the icon of whatever runs the program, which is
    // node.exe.
    window.setWindowIcon(mark);
    window.setTaskbarIcon(mark);
  }
  const index = indexAddress(found.runtime);
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
      setTimeout(() => content.loadUrl(index), 0);
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

  let named = THE_PLUGIN_LIST;
  content.on('navigation', (event) => {
    const open = event.url === undefined ? undefined : pluginOpenAt(event.url);
    const now = open ?? THE_PLUGIN_LIST;
    if (now === named) return;
    named = now;
    // The strip is written again rather than reached into. It is a small page,
    // and the program owns every byte of it.
    strip.loadHtml(stripPage(now));
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

  shown = { window, strip, content, context };
  content.loadUrl(index);

  await new Promise<void>((done) => {
    // Closing the window ends the program, because FirstMate has nothing else
    // on this desktop yet. The notification-area icon changes that.
    //
    // The wait ends before the application is told to go, never after. An exit
    // refuses every later call into the library, and one that answers with a
    // throw would leave this wait standing for ever: the program would then end
    // with Node complaining about an await that never settled.
    app.on('application-close-requested', () => {
      shown = undefined;
      done();
      try {
        app.exit();
      } catch {
        // It is already going. There is nothing to add.
      }
    });
    app.run();
  });
  return 0;
}

/**
 * The window's mark, or nothing at all.
 *
 * A window with no icon is still a window, so a mark that cannot be read costs
 * the icon and not the program. It is surprising enough to say once.
 */
function icon(): Buffer | undefined {
  try {
    return readFileSync(ICON);
  } catch (fault: unknown) {
    const said = fault instanceof Error ? fault.message : String(fault);
    console.error(`firstmate: the window opens without its icon: ${said}`);
    return undefined;
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
