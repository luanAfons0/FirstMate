/**
 * Notices, shown as Windows notifications under FirstMate's name and mark.
 *
 * The App holds the Host, so it hears each Notice as the Host takes it, from
 * a Plugin Server or from the Host itself, and shows it at once: no poll, and
 * no PowerShell helper (ADR-0014). A click opens the Notice's address in the
 * window: under the sender's own `/p/<name>/`, or the Index Page for the
 * Host's own. The title already names the sender, because the Host wrote it.
 *
 * Windows names a notification, and draws its mark, from the Application
 * User Model ID it is sent under. The App sets its own, the one the installer
 * gives its Start menu entry (`appId` in `electron-builder.yml`), so a Notice
 * says FirstMate and not Electron.
 */
import { app, Notification } from 'electron';
import type { Notice } from '@firstmate/host/notices';
import { markPath } from './marks.ts';

/** The App's Application User Model ID: `appId` in `electron-builder.yml`. */
export const APP_ID = 'io.github.luanafons0.firstmate';

/**
 * How many shown Notices the App keeps a hold on. A notification the program
 * no longer holds can still be shown, but its click goes nowhere, so the last
 * few are held, as the Host holds the last few.
 */
const HELD = 20;

/** Show Notices, and send a click on one to the window. */
export type NoticeShower = {
  /** Show one Notice from the Host. */
  show(notice: Notice): void;
  /**
   * Say one sentence of the App's own, such as a key it could not take. It
   * is shown as a Notice from FirstMate, and a click on it opens nothing.
   */
  say(sentence: string): void;
};

/**
 * Name the App to Windows. It must happen before the first notification, and
 * before the window, so that both are grouped under FirstMate.
 */
export function nameTheApp(): void {
  app.setAppUserModelId(APP_ID);
}

/** Get ready to show Notices. `open` shows one address of the Host in the window. */
export function showNotices(open: (path: string) => void): NoticeShower {
  const held = new Set<Notification>();
  const keep = (shown: Notification): void => {
    held.add(shown);
    for (const old of held) {
      if (held.size <= HELD) break;
      held.delete(old);
    }
  };

  const pop = (title: string, body: string, address: string | undefined): void => {
    if (!Notification.isSupported()) {
      console.error(`FirstMate: Windows cannot show this Notice: ${title}: ${body}`);
      return;
    }
    const shown = new Notification({ title, body, icon: markPath('running') });
    shown.on('click', () => {
      held.delete(shown);
      if (address !== undefined) open(address);
    });
    shown.on('failed', (_event, error) => {
      held.delete(shown);
      console.error(`FirstMate: Windows would not show a Notice: ${error}`);
    });
    keep(shown);
    shown.show();
  };

  return {
    show: (notice) => pop(notice.title, notice.body, notice.address),
    say(sentence) {
      // The line in the log is where the operator can read it again.
      console.error(`FirstMate: ${sentence}`);
      pop('FirstMate', sentence, undefined);
    },
  };
}
