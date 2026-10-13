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
 * The strip, the switcher, the Settings View, the Mate panel and the Mate box
 * are the App's own views, with pages the App writes (`pages.ts`). They are the only views
 * that carry the preload, so they are the only pages that can ask the main
 * process for anything, and the main process checks which view asked. Each
 * loads its page once; after that the main process sends it what it shows,
 * and the page puts it in place, so a change never loads it again. A Plugin
 * Page cannot
 * reach them, and it cannot reach another Plugin's view: a link to another
 * Plugin's address is refused in its own view and opened in the other one.
 *
 * The Mate panel is at the right, below the strip. Open, it narrows the shown
 * view by its width, as a narrower window would; expanded, it takes the whole
 * width below the strip, and the shown view is hidden and stays loaded. It
 * covers no part of a page (ADR-0008). It stays open, with its Conversation,
 * when the operator opens another Plugin, and it opens again on the same
 * Conversation and at the same width while the App runs. Recents shows in
 * the panel, in place of its Conversation, and opens an older one. The strip's Mate
 * button and Ctrl+Shift+K open and close it; the window reads that key in
 * every view before the page does, a Plugin Page too, and keeps it from the
 * page. The Mate runs the operator's Agent, so the main process takes a Mate
 * ask from the panel alone (ADR-0031).
 *
 * While the Index Page is shown, the Mate box sits between the strip and the
 * Index Page's view, and that view moves down by the box's height, so the box
 * covers no part of the Plugin list. The box is an App view too, and the
 * Index Page is the Host's, byte for byte (ADR-0008). Enter there opens the
 * panel with a new Conversation, and the main process takes that ask from
 * the box alone.
 *
 * The window shows the Host and nothing else. A link to anywhere else, in a new
 * window or the same one, opens in the operator's own browser.
 *
 * On Windows and Linux the strip is the title bar: the window hides its own,
 * and the system draws the window's buttons over the strip's right end, in
 * the strip's colours, light or dark as the system is. The strip stops short
 * of them, so no part of it is ever under a button.
 *
 * The window is made before the Host is ready, so that it and the Tray show
 * while the Host still starts every Plugin Server. Until `ready`, the strip
 * says "Starting…" and no view below it loads; what the operator opened in that
 * time loads when the Host is ready. An App started hidden loads no page at
 * all until the window is first revealed or opened, or a Popup asks for the
 * cookie.
 */
import { fileURLToPath } from 'node:url';
import { titleBarColours, windowBackground } from '@firstmate/core/theme';
import {
  app,
  BaseWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  shell,
  WebContentsView,
  type Input,
  type IpcMainEvent,
  type WebContents,
} from 'electron';
import {
  admitted,
  INDEX,
  isOwnStart,
  leavesTheHost,
  onHost,
  ownerOf,
  pathOf,
  pluginPath,
  pluginSettingsPath,
  type HostAt,
} from './addresses.ts';
import { ASK_CHANNEL, readAsked, SHOW_CHANNEL, type Asked } from './ask.ts';
import { askForPlugins, askToRestart, stoppedCount, type Plugins } from './host-lists.ts';
import { markPath } from './marks.ts';
import { holdMate, type Recent } from './mate.ts';
import { BOX_HEIGHT, boxPage } from './mate-box.ts';
import { fitWidth, MATE_WIDTH, mateBounds, matePage } from './mate-view.ts';
import { APP_ID } from './notices.ts';
import {
  dataAddress,
  STRIP_HEIGHT,
  stripPage,
  SWITCHER_LEFT,
  SWITCHER_ROOM,
  SWITCHER_WIDTH,
  switcherHeight,
  switcherPage,
  type Here,
  type Written,
} from './pages.ts';
import { change, readShown, sentenceOf, type ChangeNeeds, type Outcome } from './settings.ts';
import { settingsPage } from './settings-view.ts';

/** The window's title. The strip names what is open inside it. */
const TITLE = 'FirstMate';

/** The window's first size, in logical pixels. */
const WIDTH = 1100;
const HEIGHT = 760;

/**
 * How wide the window's own buttons are where the strip is the title bar, in
 * logical pixels: three of them, 46 each as Windows draws them, and 32 each as
 * Electron draws them on Linux. The strip leaves this much free at its right
 * end. Anywhere else the window keeps its own title bar, and the strip is
 * only a strip.
 */
const BUTTONS_WIDTH =
  process.platform === 'win32' ? 138 : process.platform === 'linux' ? 96 : undefined;

/** Whether the strip is the title bar here. */
const STRIP_IS_TITLE_BAR = BUTTONS_WIDTH !== undefined;

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
  /** Bring the window up on the Settings View, whatever it showed. */
  showSettings(): void;
  /**
   * Start one Stopped Plugin's Plugin Server again, and say a failure with
   * `say`. Nothing happens before the Host is ready.
   */
  restart(name: string, say: (failed: string) => void): void;
  /** The Host is ready: load what is wanted, and stop saying "Starting…". */
  ready(host: HostAt): void;
  /** What the Host now says about its Plugins. */
  told(plugins: Plugins): void;
  /**
   * Resolves once the window's first load has traded the token for the
   * cookie, so that another window may load the Host's pages with no token.
   */
  admitted(): Promise<void>;
  /** Give a link off the Host to the operator's browser, and say so if it fails. */
  toBrowser(address: string): void;
};

/** What the Settings View needs to change a setting: the home, and a reload. */
export type SettingsNeeds = Omit<ChangeNeeds, 'window' | 'readBack'>;

/**
 * Open the window, shown unless `hidden` says the App starts in the Tray. It
 * shows the Index Page once the Host is `ready`. `refresh` asks the Host for
 * its Plugins again; the answer comes back through `told`, and it is asked
 * after every change the Settings View makes, so the Tray shows it too.
 */
export function openWindow(
  refresh: () => void,
  hidden: boolean,
  settingsNeeds: SettingsNeeds,
): Shown {
  const window = new BaseWindow({
    title: TITLE,
    width: WIDTH,
    height: HEIGHT,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    ...(STRIP_IS_TITLE_BAR
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBar() }
      : {}),
    icon: markPath('running'),
    show: false,
  });
  const followTheme = (): void => {
    window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
    if (STRIP_IS_TITLE_BAR) window.setTitleBarOverlay(titleBar());
  };
  nativeTheme.on('updated', followTheme);
  // The Windows taskbar button takes its icon from these details, not from
  // the window's icon, so they name the App's own executable and its mark.
  // Run from a clone, the executable is Electron's, and the button keeps it.
  // Only Windows has them (ADR-0026).
  if (process.platform === 'win32' && app.isPackaged) {
    window.setAppDetails({
      appId: APP_ID,
      appIconPath: process.execPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"`,
      relaunchDisplayName: TITLE,
    });
  }

  // Closing the window hides it. The Tray holds the App, and every Plugin
  // keeps running; Quit is what ends it, and only then does the window close.
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
    // Every answer that still arrives ends with the App: no Agent runs on.
    mate.stopAll();
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  /** The owner whose view is shown: a Plugin Name, or `INDEX`. */
  let current = INDEX;
  /** Whether the switcher is open, below the breadcrumb and over the page. */
  let switching = false;
  /** Whether the Settings View is shown in place of the content views. */
  let setting = false;
  /** What became of the last change the Settings View asked for. */
  let outcome: Outcome | undefined;
  /** Whether a change the Settings View asked for is still being made. */
  let busy = false;
  /** How many times the Mate panel's gear asked for the Mate section, so the page goes there. */
  let toMate = 0;
  /** What went wrong with the last thing asked for, until the next one. */
  let fault: string | undefined;
  /** Every Plugin the Host last named, in the Plugin Order. */
  let plugins: Plugins = { kind: 'untold' };
  /** One view for each owner the operator has opened. */
  const contents = new Map<string, WebContentsView>();
  /** The Host, once it is ready. Until then no view below the strip loads. */
  let host: HostAt | undefined;
  /** Whether a page is wanted yet. An App started hidden wants none until
   *  the window is first revealed or opened. */
  let woken = !hidden;
  /** What to show when the Host is ready. */
  let waiting = '/';

  /** Whether the Mate panel is open, at the right of the window. */
  let mateOpen = false;
  /** Whether the open Mate panel has the whole width below the strip. */
  let mateExpanded = false;
  /** How wide the operator left the Mate panel, kept while the App runs. */
  let mateWidth = MATE_WIDTH;
  /** How many times the Mate panel has opened, so its page knows a new opening. */
  let mateOpened = 0;
  /**
   * Recents, while the panel shows them: every Conversation as it was read
   * when Recents opened or last changed, so an answer that arrives does not
   * read every Conversation again for each of its parts.
   */
  let recents: { readonly rows: readonly Recent[]; readonly fault?: string } | undefined;

  // The order of the children is the order they are drawn in: the strip, the
  // content views, the Settings View, the Mate panel beside them, the Mate
  // box above the Index Page's view, and the switcher on top of them all.
  const strip = appView();
  const settings = appView();
  const matePanel = appView();
  const mateBox = appView();
  const switcher = appView();
  // Clear round the panel, so its round corners and its shadow show.
  switcher.setBackgroundColor('#00000000');
  window.contentView.addChildView(strip);
  window.contentView.addChildView(settings);
  window.contentView.addChildView(matePanel);
  window.contentView.addChildView(mateBox);
  window.contentView.addChildView(switcher);

  /** Each App view's page, loaded once and then sent what it shows. */
  const stripShown = ownPage(strip);
  const switcherShown = ownPage(switcher);
  const settingsShown = ownPage(settings);
  const mateShown = ownPage(matePanel);
  const boxShown = ownPage(mateBox);

  /** The Mate panel's page, as it is now, sent only while the panel is open. */
  const showMate = (): void => {
    if (!mateOpen) return;
    mateShown.show(
      matePage({
        shown: mate.shown(),
        opened: mateOpened,
        expanded: mateExpanded,
        ...(recents === undefined ? {} : { recents: { ...recents, now: new Date() } }),
      }),
    );
  };
  /** Every Conversation, read now, with what went wrong with the last thing asked of Recents. */
  const readRecents = (fault?: string): NonNullable<typeof recents> => {
    try {
      return { rows: mate.recents(), ...(fault === undefined ? {} : { fault }) };
    } catch (unread: unknown) {
      return { rows: [], fault: fault ?? sentenceOf(unread) };
    }
  };
  /** The Mate, whose every change the panel shows: a question, a part of an answer, an end. */
  const mate = holdMate(settingsNeeds.home, showMate);
  /** How many times the switcher has opened, so its page knows a new opening. */
  let opened = 0;
  /** Whether the switcher last opened from the keyboard, so it shows with no fade. */
  let instant = false;
  /** The Plugins whose restart the switcher asked for and the Host has not answered. */
  const restarting = new Set<string>();

  const here = (): Here => {
    if (setting) return { kind: 'settings' };
    return current === INDEX ? { kind: 'list' } : { kind: 'plugin', name: current };
  };

  /** Where the open Mate panel leaves the shown view, in a window this wide. */
  const mateIn = (width: number) =>
    mateBounds(width, { open: mateOpen, expanded: mateExpanded, width: mateWidth });

  /**
   * Whether the Mate box shows: only above the Index Page, once it has a view,
   * and never while the Settings View or the expanded panel hides it.
   */
  const boxShows = (): boolean => {
    const [width = 0] = window.getContentSize();
    return mateIn(width).page > 0 && !setting && current === INDEX && contents.has(INDEX);
  };

  const layout = (): void => {
    const [width = 0, height = 0] = window.getContentSize();
    const tall = Math.max(height - STRIP_HEIGHT, 0);
    // The open Mate panel narrows the shown view, as a narrower window would,
    // and covers none of it (ADR-0008). Expanded, it hides the shown view,
    // which keeps its width and stays loaded behind it.
    const sides = mateIn(width);
    const pageShows = sides.page > 0;
    const pageWidth = pageShows ? sides.page : width;
    const below = { x: 0, y: STRIP_HEIGHT, width: pageWidth, height: tall };
    // The Index Page's view sits below the Mate box, which covers none of it.
    const belowBox = {
      ...below,
      y: STRIP_HEIGHT + BOX_HEIGHT,
      height: Math.max(tall - BOX_HEIGHT, 0),
    };
    const buttons = BUTTONS_WIDTH ?? 0;
    strip.setBounds({ x: 0, y: 0, width: Math.max(width - buttons, 0), height: STRIP_HEIGHT });
    for (const [owner, view] of contents) {
      view.setBounds(owner === INDEX ? belowBox : below);
      view.setVisible(pageShows && !setting && owner === current);
    }
    mateBox.setBounds({ x: 0, y: STRIP_HEIGHT, width: pageWidth, height: BOX_HEIGHT });
    mateBox.setVisible(boxShows());
    settings.setBounds(below);
    settings.setVisible(pageShows && setting);
    matePanel.setBounds({
      x: width - sides.panel,
      y: STRIP_HEIGHT,
      width: sides.panel,
      height: tall,
    });
    matePanel.setVisible(mateOpen);
    // The view is the panel and the clear room round it for its shadow.
    const room = SWITCHER_ROOM;
    const panel = {
      width: Math.max(Math.min(SWITCHER_WIDTH, width - 2 * SWITCHER_LEFT), 0),
      height: Math.max(
        Math.min(switcherHeight(plugins), height - STRIP_HEIGHT - room.above - SWITCHER_LEFT),
        0,
      ),
    };
    switcher.setBounds({
      x: SWITCHER_LEFT - room.side,
      y: STRIP_HEIGHT,
      width: panel.width + 2 * room.side,
      height: room.above + panel.height + room.below,
    });
    switcher.setVisible(switching);
  };

  const redraw = (): void => {
    // An App started hidden loads no page at all, the strip's neither, until
    // the window first shows or a Popup asks for the cookie (#171).
    if (!woken) return;
    stripShown.show(
      stripPage({
        here: here(),
        switcher: switching,
        fault,
        starting: host === undefined,
        stopped: stoppedCount(plugins),
        mate: mateOpen,
      }),
    );
    showMate();
    // The box loads the first time it is shown, and says who answers now.
    if (boxShows()) boxShown.show(boxPage(mate.ahead()));
    // The switcher and the Settings View load the first time they are shown.
    if (switching) {
      switcherShown.show(
        switcherPage({
          open: current === INDEX ? undefined : current,
          plugins,
          opened,
          instant,
          restarting: [...restarting],
        }),
      );
    }
    if (setting) {
      // Read again each time, so a change from a terminal or the Tray shows.
      settingsShown.show(
        settingsPage({
          ...readShown(settingsNeeds.home),
          plugins,
          outcome,
          busy,
          ...(toMate === 0 ? {} : { go: { section: 'mate', count: toMate } }),
        }),
      );
    }
    layout();
  };

  /**
   * Show `path` behind whatever shows: an operator on the Settings View stays
   * there, and the page loads under it.
   */
  const behind = (path: string): void => {
    const stay = setting;
    open(path);
    if (stay) {
      setting = true;
      redraw();
      settings.webContents.focus();
    }
  };

  /**
   * Want pages from now on. Once the Host is ready, the first load is the
   * Index Page, which trades the token for the cookie.
   */
  const wake = (): void => {
    const was = woken;
    woken = true;
    if (host !== undefined && admission === undefined) behind('/');
    else if (!was) redraw();
  };

  const reveal = (): void => {
    wake();
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
  const contentView = (owner: string, host: HostAt): WebContentsView => {
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
    holdMateKey(page);
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
  const loadContent = (view: WebContentsView, path: string, host: HostAt): void => {
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
    if (host === undefined) {
      // Asked for before the Host is ready: shown when it is.
      woken = true;
      waiting = path;
      setting = false;
      switching = false;
      fault = undefined;
      redraw();
      return;
    }
    const owner = ownerOf(host, path) ?? INDEX;
    const known = contents.get(owner);
    const view = known ?? contentView(owner, host);
    // The Index Page is the Host's own and keeps nothing, so it is loaded
    // again each time, to show the Plugins as they are now.
    const again = how === 'load' && !isOwnStart(owner, path);
    if (known === undefined || owner === INDEX || again) loadContent(view, path, host);
    current = owner;
    setting = false;
    switching = false;
    // A page the operator asked for is shown: an expanded Mate panel gives
    // it back its side, and stays open beside it with its Conversation.
    mateExpanded = false;
    fault = undefined;
    redraw();
    view.webContents.focus();
  };

  /** The Plugin of this name, as the Host last named it. */
  const named = (name: string) =>
    plugins.kind === 'told' ? plugins.plugins.find((plugin) => plugin.name === name) : undefined;

  /**
   * Start one Stopped Plugin's Plugin Server again, through the Host's restart
   * address, as `firstmate restart` does. The switcher and the Tray both ask
   * here. Only the operator's ask does this: the Host never restarts a Plugin
   * Server on its own account. Its row says Restarting… until the Host
   * answers, and then what the Host says now. A refusal is the strip's fault
   * line, unless the one who asked says it another way.
   */
  const restart = (name: string, say?: (failed: string) => void): void => {
    if (host === undefined || restarting.has(name) || named(name)?.state !== 'stopped') return;
    const at = host;
    restarting.add(name);
    redraw();
    void askToRestart(at, name).then(async (failed) => {
      plugins = await askForPlugins(at);
      restarting.delete(name);
      if (failed !== undefined && say !== undefined) say(failed);
      else fault = failed;
      // The Tray shows the new state too.
      refresh();
      redraw();
    });
  };

  /** A change to a setting, which `change()` makes. */
  const SETTING: ReadonlySet<Asked['kind']> = new Set([
    'logon',
    'place-add',
    'place-remove',
    'shelf',
    'shelf-choose',
    'plugin-move',
    'mate-set',
  ]);
  /**
   * What only the Settings View may ask for: a change to a setting, and a
   * Plugin's Plugin Settings, which only its Open settings button asks for
   * (ADR-0029).
   */
  const SETTINGS_VIEW_ONLY: ReadonlySet<Asked['kind']> = new Set([...SETTING, 'plugin-settings']);

  const act = (asked: Asked): void => {
    if (asked.kind === 'plugin-list') {
      open('/');
    } else if (
      asked.kind === 'switcher' ||
      asked.kind === 'switcher-keys' ||
      asked.kind === 'switcher-close'
    ) {
      switching = asked.kind !== 'switcher-close' && !switching;
      if (switching) {
        // Counted on every open, so that its page starts again from an empty
        // filter and the open Plugin each time.
        opened += 1;
        instant = asked.kind === 'switcher-keys';
        refresh();
      }
      redraw();
      // The filter takes the focus, so the operator can type at once.
      if (switching) switcher.webContents.focus();
    } else if (asked.kind === 'restart') {
      restart(asked.name);
    } else if (asked.kind === 'open') {
      if (named(asked.name)?.hasPage === true) {
        open(pluginPath(asked.name));
      } else {
        switching = false;
        redraw();
      }
    } else if (asked.kind === 'plugin-settings') {
      // The Plugin's own view, at its Plugin Settings, as the switcher opens
      // its Plugin Page: a Stopped Plugin too, which may need a setting to
      // start. The address is not the view's first page, so it is loaded
      // even when the view is open; a view already on that page only moves
      // to the fragment, and the page hears a hashchange. The Settings View
      // closes. The App reads none of what it shows (ADR-0029, ADR-0005).
      if (named(asked.name)?.hasPage === true) open(pluginSettingsPath(asked.name));
    } else if (asked.kind === 'settings' || asked.kind === 'mate-settings') {
      // The panel's settings button opens the Settings View at its Mate
      // section, and never closes it.
      setting = asked.kind === 'mate-settings' || !setting;
      if (asked.kind === 'mate-settings') toMate += 1;
      switching = false;
      fault = undefined;
      outcome = undefined;
      // The Settings View shows beside an open Mate panel, as a page does.
      if (setting) mateExpanded = false;
      redraw();
      if (setting) settings.webContents.focus();
    } else if (asked.kind === 'mate') {
      toggleMate();
    } else if (asked.kind === 'mate-close') {
      if (mateOpen) toggleMate();
    } else if (asked.kind === 'mate-new') {
      recents = undefined;
      mate.fresh();
      mateOpened += 1;
      showMate();
    } else if (asked.kind === 'mate-recents') {
      recents = readRecents();
      showMate();
    } else if (asked.kind === 'mate-back') {
      recents = undefined;
      showMate();
    } else if (asked.kind === 'mate-open') {
      // Opened, it shows in place of Recents; one that cannot be read stays
      // in Recents, which says why.
      recents = undefined;
      try {
        mate.open(asked.id);
        mateOpened += 1;
      } catch (fault: unknown) {
        recents = readRecents(sentenceOf(fault));
      }
      showMate();
    } else if (asked.kind === 'mate-delete') {
      // FirstMate's file of the Conversation alone; the Agent keeps its own
      // session (ADR-0031).
      try {
        mate.forget(asked.id);
        recents = readRecents();
      } catch (fault: unknown) {
        recents = readRecents(sentenceOf(fault));
      }
      showMate();
    } else if (asked.kind === 'mate-expand') {
      mateExpanded = !mateExpanded;
      redraw();
    } else if (asked.kind === 'mate-width') {
      mateWidth = fitWidth(asked.width);
      layout();
    } else if (asked.kind === 'mate-ask') {
      // The box starts a new Conversation in the panel, which opens on it.
      recents = undefined;
      mate.fresh();
      mate.send(asked.text);
      mateOpened += 1;
      if (!mateOpen) {
        toggleMate();
      } else {
        redraw();
        matePanel.webContents.focus();
      }
    } else if (asked.kind === 'mate-send') {
      mate.send(asked.text);
    } else if (asked.kind === 'mate-stop') {
      mate.stop();
    } else if (asked.kind === 'mate-copy') {
      const text = mate.textOf(asked.message);
      if (text !== undefined) clipboard.writeText(text);
    } else if (asked.kind === 'mate-link') {
      toBrowser(asked.address);
    } else if (SETTING.has(asked.kind) && !busy) {
      // A setting. One change at a time: a wsl Place can take a while to add.
      busy = true;
      redraw();
      const readBack = async (): Promise<void> => {
        if (host !== undefined) plugins = await askForPlugins(host);
      };
      void change(asked, { ...settingsNeeds, window: () => window, readBack }).then((said) => {
        busy = false;
        outcome = said;
        // An Index Page already loaded shows the new Plugin Order at once.
        const index = contents.get(INDEX);
        if (asked.kind === 'plugin-move' && said?.done === true && host !== undefined && index) {
          loadContent(index, '/', host);
        }
        refresh();
        redraw();
      });
    }
  };

  /**
   * Open the Mate panel, or close it when it is open. Open, it takes the
   * focus, so the operator can type at once; closed, it gives the focus back
   * to what is shown.
   */
  const toggleMate = (): void => {
    mateOpen = !mateOpen;
    switching = false;
    // The panel opens again on its Conversation, never on Recents.
    recents = undefined;
    if (mateOpen) mateOpened += 1;
    redraw();
    if (mateOpen) matePanel.webContents.focus();
    else (setting ? settings : contents.get(current))?.webContents.focus();
  };

  /**
   * Hold Ctrl+Shift+K in one of the window's views: it opens and closes the
   * Mate panel whatever has the focus, a Plugin Page too. The window reads
   * the key before the page does and keeps that one key from it; it injects
   * nothing into the page and reads nothing else of it (ADR-0008). It is not
   * a Shortcut: it is held only while the window has the focus, and nothing
   * binds it from a terminal (ADR-0013).
   */
  const holdMateKey = (page: WebContents): void => {
    page.on('before-input-event', (event, input) => {
      if (!isMateKey(input)) return;
      event.preventDefault();
      toggleMate();
    });
  };
  for (const view of [strip, settings, matePanel, mateBox, switcher]) {
    holdMateKey(view.webContents);
  }

  /** What only the Mate panel may ask for: everything it does with the Mate. */
  const MATE_PANEL_ONLY: ReadonlySet<Asked['kind']> = new Set([
    'mate-close',
    'mate-new',
    'mate-recents',
    'mate-back',
    'mate-open',
    'mate-delete',
    'mate-expand',
    'mate-settings',
    'mate-send',
    'mate-stop',
    'mate-copy',
    'mate-link',
    'mate-width',
  ]);

  const ask = (event: IpcMainEvent, said: unknown): void => {
    // Only the App's own views carry the preload. The check is here as well,
    // so that the rule does not rest on the preload alone.
    const own = [strip, switcher, settings, matePanel, mateBox].some(
      (view) => view.webContents === event.sender,
    );
    if (!own) return;
    const asked = readAsked(said);
    if (SETTINGS_VIEW_ONLY.has(asked.kind) && event.sender !== settings.webContents) return;
    // Only the switcher carries a Restart button.
    if (asked.kind === 'restart' && event.sender !== switcher.webContents) return;
    // The Mate runs the operator's Agent: it takes an ask from its own panel
    // alone, and the strip only opens and closes it (ADR-0031).
    if (MATE_PANEL_ONLY.has(asked.kind) && event.sender !== matePanel.webContents) return;
    if (asked.kind === 'mate' && event.sender !== strip.webContents) return;
    // The box asks the Mate one thing, and nothing else asks it that.
    if ((asked.kind === 'mate-ask') !== (event.sender === mateBox.webContents)) return;
    // The panel asks for nothing else.
    if (event.sender === matePanel.webContents && !MATE_PANEL_ONLY.has(asked.kind)) return;
    act(asked);
  };
  ipcMain.on(ASK_CHANNEL, ask);

  window.on('resize', layout);
  window.on('maximize', layout);
  window.on('unmaximize', layout);
  window.on('restore', layout);
  window.on('closed', () => {
    ipcMain.off(ASK_CHANNEL, ask);
    nativeTheme.off('updated', followTheme);
    for (const view of [strip, switcher, settings, matePanel, mateBox, ...contents.values()]) {
      view.webContents.close();
    }
  });

  redraw();
  if (!hidden) window.show();

  return {
    window,
    open: (path) => {
      open(path);
      reveal();
    },
    reveal,
    restart,
    showSettings: () => {
      if (!setting) act({ kind: 'settings' });
      reveal();
    },
    ready: (at) => {
      host = at;
      // An operator who went to the Settings View while the Host started
      // stays there.
      if (woken) behind(waiting);
    },
    admitted: () => {
      // A Popup opened before the window ever showed needs the cookie too,
      // so the Index Page loads, hidden, to trade the token for it.
      wake();
      return admission ?? Promise.resolve();
    },
    toBrowser,
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
 * Whether a key is the Mate's: Ctrl+Shift+K, pressed and not held, by the
 * letter it types, so it follows the operator's keyboard layout.
 */
function isMateKey(input: Input): boolean {
  return (
    input.type === 'keyDown' &&
    !input.isAutoRepeat &&
    input.control &&
    input.shift &&
    !input.alt &&
    !input.meta &&
    input.key.toLowerCase() === 'k'
  );
}

/** The window's own buttons, as tall as the strip and in its colours. */
function titleBar(): { color: string; symbolColor: string; height: number } {
  return { ...titleBarColours(nativeTheme.shouldUseDarkColors), height: STRIP_HEIGHT };
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

/** One App view's page, as the main process keeps it. */
type OwnPage = {
  /** Show this in the view: load the page the first time, then send the body. */
  show(written: Written): void;
};

/**
 * The page of one App view. The whole page loads once, with the body of that
 * moment. A body that comes while it loads waits until it has loaded, and only
 * the last one is sent. A body the page already shows is not sent again. A
 * page that failed to load, or whose renderer went away, loads again the next
 * time it is shown.
 */
function ownPage(view: WebContentsView): OwnPage {
  const page = view.webContents;
  let state: 'unloaded' | 'loading' | 'loaded' = 'unloaded';
  /** The body the page shows, or will once it has loaded. */
  let had = '';
  /** The last page asked for. */
  let wanted: Written | undefined;
  const send = (): void => {
    if (wanted === undefined || wanted.body === had) return;
    had = wanted.body;
    page.send(SHOW_CHANNEL, had);
  };
  const show = (written: Written): void => {
    // A change told after the window closed has no page to go to.
    if (page.isDestroyed()) return;
    wanted = written;
    if (state === 'loaded') {
      send();
      return;
    }
    if (state === 'loading') return;
    state = 'loading';
    had = written.body;
    // A load cut short by the view's close is not a fault.
    page.loadURL(dataAddress(written.whole(written.body))).catch(() => undefined);
  };
  page.on('did-finish-load', () => {
    state = 'loaded';
    send();
  });
  const lost = (): void => {
    state = 'unloaded';
    had = '';
  };
  page.on('did-fail-load', lost);
  page.on('render-process-gone', lost);
  return { show };
}

/** Open an address in the operator's browser, when it is one a browser opens. */
function openOutside(address: string): Promise<void> {
  const protocol = URL.parse(address)?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
    return Promise.resolve();
  }
  return shell.openExternal(address);
}
