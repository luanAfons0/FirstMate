/**
 * The Popup: the small window with no frame that a Shortcut opens, on top of
 * every other window (ADR-0013).
 *
 * It is not the FirstMate window. It loads one address of one Plugin and shows
 * the bytes the Host serves, with no preload and the sandbox on, so it frames
 * nothing (ADR-0008). It hides when it loses focus, on Esc, when its own
 * Shortcut is pressed again, and when its page navigates away from its own
 * address: the App refuses that navigation and hides the Popup, which is how a
 * Plugin Page says "I am finished" with no channel into the App.
 */
import { app, BrowserWindow } from 'electron';
import { leavesTheHost, onHost, type HostAt } from './addresses.ts';
import { markPath } from './marks.ts';

/** The Popup's size, in logical pixels: a small form, not a program. */
const WIDTH = 680;
const HEIGHT = 540;

/**
 * How long a Popup that lost focus waits before it looks again. Focus moving
 * into the Popup's own page is not focus leaving it, and a moment tells the
 * two apart.
 */
const BLUR_GRACE_MS = 120;

/** The Popup, and the ways to show and hide it. */
export type Popup = {
  /** Show one address of the Host, opened by these keys. */
  show(keys: string, path: string): void;
  /** Hide it, if these keys opened it. */
  hideIfOpenedBy(keys: string): void;
  /** The keys that opened the Popup, while it is shown. */
  shownBy(): string | undefined;
};

/** What the Popup needs from the rest of the App. */
export type PopupNeeds = {
  readonly host: HostAt;
  /** Resolves once the window's first load has traded the token for the cookie. */
  readonly admitted: () => Promise<void>;
  /** Give a link off the Host to the operator's browser. */
  readonly toBrowser: (address: string) => void;
};

/** Make the Popup, hidden. */
export function makePopup(needs: PopupNeeds): Popup {
  const window = new BrowserWindow({
    title: 'FirstMate',
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    icon: markPath('running'),
    backgroundColor: '#17181a',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const page = window.webContents;

  /** The keys that opened it, and its own address, while it is shown. */
  let shown: { readonly keys: string; readonly own: string } | undefined;

  const hide = (): void => {
    if (shown === undefined) return;
    shown = undefined;
    window.hide();
    // The page goes with the Popup, so the next one loads fresh and never
    // flashes the last.
    page.loadURL('about:blank').catch(() => undefined);
  };

  page.on('will-navigate', (event, url) => {
    // A link to the web is not the page saying it is finished.
    if (leavesTheHost(needs.host, url)) {
      event.preventDefault();
      needs.toBrowser(url);
      return;
    }
    if (shown === undefined || !leavesPopup(shown.own, url)) return;
    event.preventDefault();
    hide();
  });
  page.setWindowOpenHandler(({ url }) => {
    if (leavesTheHost(needs.host, url)) needs.toBrowser(url);
    return { action: 'deny' };
  });
  page.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') hide();
  });
  window.on('blur', () => {
    setTimeout(() => {
      if (shown !== undefined && !window.isFocused()) hide();
    }, BLUR_GRACE_MS);
  });

  // Alt+F4 puts it away like every other way out of it. Only Quit closes it.
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hide();
  });

  return {
    show(keys, path) {
      const own = onHost(needs.host, path);
      shown = { keys, own };
      void needs
        .admitted()
        .then(() => page.loadURL(own))
        .catch(() => undefined);
      window.center();
      window.show();
      window.focus();
    },
    hideIfOpenedBy(keys) {
      if (shown?.keys === keys) hide();
    },
    shownBy: () => shown?.keys,
  };
}

/**
 * Whether a navigation leaves the Popup's own address: its origin and its
 * path. The query and the fragment may change, because a form may use them.
 * The blank page leaves nothing. Anything that cannot be read leaves, because
 * a Popup never shows a second page.
 */
function leavesPopup(own: string, address: string): boolean {
  if (address === 'about:blank') return false;
  const there = URL.parse(address);
  const here = URL.parse(own);
  if (there === null || here === null) return true;
  return there.origin !== here.origin || there.pathname !== here.pathname;
}
