/**
 * The bridge the App's own views ask the main process through: the strip, the
 * switcher and the Settings View.
 *
 * It is loaded into those views and into no other. A Plugin Page, the Index
 * Page and the Popup have no preload at all, so a page the Host serves can
 * never reach it (ADR-0008). It gives a view one thing, `firstmate.ask`, which
 * sends one string; the main process reads it and checks which view sent it.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { ASK_CHANNEL } from './ask.ts';

contextBridge.exposeInMainWorld('firstmate', {
  ask: (what: unknown): void => {
    if (typeof what === 'string') ipcRenderer.send(ASK_CHANNEL, what);
  },
});
