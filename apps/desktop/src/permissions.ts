/**
 * What a Plugin Page may use of the operator's machine.
 *
 * Electron allows every permission a page asks for unless it is told
 * otherwise. The App tells it otherwise: every permission is refused, for
 * every page, except what a Plugin Page may have. It may write to the
 * clipboard, unasked, as any web page may when the operator clicks "copy";
 * it never reads it. And it may ask for two devices, the microphone and a
 * capture of the screen or a window with its sound. scribe records a call
 * with them. The first time a Plugin asks for one, the App asks the operator,
 * naming the Plugin, and keeps the answer for that Plugin in the settings
 * file, so the operator is asked once and not on every call.
 *
 * Which Plugin asks is read from the address of the page that asks: an
 * address under `/p/<name>/` on the Host is that Plugin's, and anything else,
 * the Index Page and the App's own pages among them, is refused unasked.
 *
 * The answer is written by the main process, after the operator answers the
 * App's own dialog. No page can write it, and no page can answer for the
 * operator, because the dialog is not a page (ADR-0012).
 */
import {
  desktopCapturer,
  dialog,
  session,
  type BaseWindow,
  type DesktopCapturerSource,
  type MessageBoxOptions,
} from 'electron';
import { readSettings, writeSettings, type PermissionAnswers } from '@firstmate/core/settings';
import { INDEX, ownerOf, type HostAt } from './addresses.ts';

/** A device a Plugin Page may ask for. */
type Device = keyof PermissionAnswers;

/** How the App names each device when it asks the operator. */
const ASKING: Readonly<Record<Device, string>> = {
  microphone: 'use the microphone',
  capture: 'capture your screen or a window, with its sound',
};

/**
 * What a Plugin Page is given unasked: writing to the clipboard. Reading it is
 * refused, because the clipboard may hold what another program put there.
 */
const GIVEN: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

/** The most screens and windows the App offers to capture in one dialog. */
const SOURCES_SHOWN = 8;

/** What the permissions need from the rest of the App. */
export type PermissionNeeds = {
  readonly host: HostAt;
  /** The Host's home, where the settings file is. */
  readonly home: string;
  /** The window a dialog belongs to, when there is one. */
  readonly window: () => BaseWindow | undefined;
  /** Say one sentence to the operator. */
  readonly say: (sentence: string) => void;
};

/** Refuse every permission except the two a Plugin may be given, and ask for those. */
export function guardPermissions(needs: PermissionNeeds): void {
  const shared = session.defaultSession;
  /** An answer being asked for, so that two requests ask the operator once. */
  const asking = new Map<string, Promise<boolean>>();

  const answered = (plugin: string, device: Device): Promise<boolean> => {
    const kept = keptAnswer(needs.home, plugin, device);
    if (kept !== undefined) return Promise.resolve(kept);
    const key = `${plugin}/${device}`;
    const pending = asking.get(key) ?? ask(plugin, device);
    asking.set(key, pending);
    return pending.finally(() => asking.delete(key));
  };

  const ask = async (plugin: string, device: Device): Promise<boolean> => {
    const shown = await messageBox(needs.window(), {
      type: 'question',
      title: 'FirstMate',
      message: `${plugin} asks to ${ASKING[device]}.`,
      detail:
        `FirstMate keeps your answer for ${plugin} and does not ask again. ` +
        `To be asked again, take ${plugin} out of "permissions" in the settings file.`,
      buttons: ['Allow', 'Refuse'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    const allowed = shown.response === 0;
    try {
      keepAnswer(needs.home, plugin, device, allowed);
    } catch (fault: unknown) {
      // The answer still holds for this request; it is only not kept.
      const why = fault instanceof Error ? fault.message : String(fault);
      needs.say(`FirstMate could not keep your answer for ${plugin}: ${why}`);
    }
    return allowed;
  };

  shared.setPermissionRequestHandler((contents, permission, callback, details) => {
    const plugin = pluginAt(needs.host, details.requestingUrl ?? contents.getURL());
    if (plugin !== undefined && GIVEN.has(permission)) {
      callback(true);
      return;
    }
    const types = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const device = permission === 'media' ? mediaDevice(types) : undefined;
    if (plugin === undefined || device === undefined) {
      callback(false);
      return;
    }
    answered(plugin, device).then(callback, () => callback(false));
  });

  // A check asks, with no prompt, whether a permission is already given. Only
  // what a Plugin Page is given unasked, or an answer the operator gave, says yes.
  shared.setPermissionCheckHandler((contents, permission, origin, details) => {
    const plugin = pluginAt(needs.host, details.requestingUrl ?? contents?.getURL() ?? origin);
    if (plugin === undefined) return false;
    if (GIVEN.has(permission)) return true;
    if (permission !== 'media' || details.mediaType !== 'audio') return false;
    return keptAnswer(needs.home, plugin, 'microphone') === true;
  });

  // No Plugin Page reaches a USB, serial or HID device.
  shared.setDevicePermissionHandler(() => false);

  shared.setDisplayMediaRequestHandler((request, callback) => {
    const refuse = (): void => callback({});
    const plugin = pluginAt(needs.host, request.frame?.url ?? '');
    if (plugin === undefined || !request.videoRequested) {
      refuse();
      return;
    }
    answered(plugin, 'capture')
      .then(async (allowed) => {
        if (!allowed) return refuse();
        const source = await chooseSource(plugin, needs.window());
        if (source === undefined) return refuse();
        // The sound of the whole machine, which is how a call is heard.
        callback({ video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) });
      })
      .catch(refuse);
  });
}

/**
 * The Plugin whose page is at this address, or undefined when the address is
 * not a Plugin's: the Index Page, the App's own pages, or anything off the Host.
 */
function pluginAt(host: HostAt, address: string): string | undefined {
  const owner = ownerOf(host, address);
  return owner === undefined || owner === INDEX ? undefined : owner;
}

/**
 * The device a media request asks for: the microphone, when that is all it
 * asks for, or a capture, which Electron asks for as media with no type of
 * its own. A camera, alone or beside the microphone, is refused.
 */
function mediaDevice(types: readonly string[] | undefined): Device | undefined {
  if (types === undefined) return undefined;
  if (types.length === 0) return 'capture';
  return types.every((type) => type === 'audio') ? 'microphone' : undefined;
}

/** The answer the operator gave this Plugin, or undefined when it was never asked. */
function keptAnswer(home: string, plugin: string, device: Device): boolean | undefined {
  try {
    return readSettings(home).permissions?.[plugin]?.[device];
  } catch (fault: unknown) {
    // A damaged settings file allows nothing, and says why.
    console.error(`FirstMate: ${fault instanceof Error ? fault.message : String(fault)}`);
    return false;
  }
}

/** Keep one answer. The rest of the settings are read again first and kept as they are. */
function keepAnswer(home: string, plugin: string, device: Device, allowed: boolean): void {
  const settings = readSettings(home);
  const permissions = settings.permissions ?? {};
  writeSettings(home, {
    ...settings,
    permissions: { ...permissions, [plugin]: { ...permissions[plugin], [device]: allowed } },
  });
}

/**
 * Ask the operator which screen or window to give. Windows has no picker of
 * its own for Electron, so the App asks, with one button for each.
 */
async function chooseSource(
  plugin: string,
  window: BaseWindow | undefined,
): Promise<DesktopCapturerSource | undefined> {
  const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).slice(
    0,
    SOURCES_SHOWN,
  );
  if (sources.length === 0) return undefined;
  const shown = await messageBox(window, {
    type: 'question',
    title: 'FirstMate',
    message: `What may ${plugin} capture?`,
    buttons: [...sources.map((source) => source.name), 'Nothing'],
    defaultId: sources.length,
    cancelId: sources.length,
    noLink: true,
  });
  return sources[shown.response];
}

/** A message box, on the window when there is one, and on its own when there is not. */
function messageBox(
  window: BaseWindow | undefined,
  options: MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return window === undefined || window.isDestroyed()
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(window, options);
}
