/**
 * The Tray: the App's notification-area icon and its menu.
 *
 * The icon wears the running mark, or the stopped mark while any Plugin is
 * Stopped, so a broken Plugin shows without opening anything. A click on it
 * brings the window up. Its menu opens the Index Page, opens each Plugin,
 * turns start at logon on and off, and quits. Quit is the one way the App
 * ends: closing the window only hides it, and every Plugin keeps running.
 *
 * Start at logon is Windows's own entry for the App (`logon.ts`), and it is off
 * until the operator turns it on. The App it starts begins in the
 * Tray, with the window put away, because nobody asked to see it.
 */
import { app, Menu, Tray, type MenuItemConstructorOptions } from 'electron';
import { STATE_WORDS } from '@firstmate/core/plugin-state';
import { pluginPath } from './addresses.ts';
import type { PluginSeen, Plugins } from './host-lists.ts';
import { readLogon, writeLogon } from './logon.ts';
import { markPath } from './marks.ts';

/** What the Tray needs from the rest of the App. */
export type TrayNeeds = {
  /** Show one address of the Host in the window, and bring the window up. */
  readonly open: (path: string) => void;
  /** Bring the window up as it was. */
  readonly reveal: () => void;
  /** Start at logon changed, so the Settings View shows it too. */
  readonly changed: () => void;
};

/** The Tray, and the way to tell it what the Host now says. */
export type HeldTray = {
  /** What the Host now says about its Plugins. */
  told(plugins: Plugins): void;
};

/** Put FirstMate in the notification area. */
export function holdTray(needs: TrayNeeds): HeldTray {
  const tray = new Tray(markPath('running'));
  let plugins: Plugins = { kind: 'untold' };
  /** What the menu was last built from. Building it again unchanged is churn. */
  let built = '';

  const draw = (): void => {
    const logon = readLogon();
    const said = `${signature(plugins)}|${logon}`;
    if (said === built) return;
    built = said;
    const stopped = stoppedCount(plugins);
    tray.setImage(markPath(stopped > 0 ? 'stopped' : 'running'));
    tray.setToolTip(tooltip(stopped));
    tray.setContextMenu(Menu.buildFromTemplate(menu(plugins, logon, needs, draw)));
  };

  // A click opens the window, which is the thing wanted nearly every time.
  // The menu is one click to the right of it.
  tray.on('click', () => needs.reveal());
  draw();

  return {
    told(now) {
      plugins = now;
      draw();
    },
  };
}

/**
 * The menu. The Plugins are a submenu rather than a run of items, so that
 * Quit never moves under the pointer when a Plugin is added or taken away.
 */
function menu(
  plugins: Plugins,
  logon: boolean,
  needs: TrayNeeds,
  draw: () => void,
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open FirstMate', click: () => needs.open('/') },
    { label: 'Plugins', submenu: pluginItems(plugins, needs) },
    { type: 'separator' },
    {
      label: 'Start at logon',
      type: 'checkbox',
      checked: logon,
      click: (item) => {
        writeLogon(item.checked);
        needs.changed();
        draw();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

/**
 * Every Plugin, or the one sentence that stands in for the list. A Host that
 * would not say and a Registry with nothing in it get different sentences,
 * because they are different states (#44).
 */
function pluginItems(plugins: Plugins, needs: TrayNeeds): MenuItemConstructorOptions[] {
  if (plugins.kind === 'untold') return [{ label: 'The Host would not say', enabled: false }];
  if (plugins.plugins.length === 0) return [{ label: 'No Plugin is registered', enabled: false }];
  return plugins.plugins.map((plugin) => ({
    label: pluginLabel(plugin),
    // A Plugin that ships no Plugin Page has no address to open, so it is
    // shown and not offered. A Stopped Plugin is still offered: the Host
    // serves its page whatever its Plugin Server is doing.
    enabled: plugin.hasPage,
    click: () => needs.open(pluginPath(plugin.name)),
  }));
}

function pluginLabel(plugin: PluginSeen): string {
  return plugin.state === 'running' ? plugin.name : `${plugin.name} — ${STATE_WORDS[plugin.state]}`;
}

function stoppedCount(plugins: Plugins): number {
  return plugins.kind === 'told'
    ? plugins.plugins.filter((plugin) => plugin.state === 'stopped').length
    : 0;
}

/** What the icon says when the pointer rests on it. */
function tooltip(stopped: number): string {
  if (stopped === 0) return 'FirstMate';
  return stopped === 1
    ? 'FirstMate: 1 Plugin is Stopped'
    : `FirstMate: ${stopped} Plugins are Stopped`;
}

/** What a menu is built from, as one string. */
function signature(plugins: Plugins): string {
  return plugins.kind === 'untold'
    ? 'untold'
    : plugins.plugins.map((p) => `${p.name}/${p.hasPage}/${p.state}`).join(',');
}
