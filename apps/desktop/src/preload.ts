/**
 * The bridge between the main process and the App's own views: the strip, the
 * switcher and the Settings View.
 *
 * It is loaded into those views and into no other. A Plugin Page, the Index
 * Page and the Popup have no preload at all, so a page the Host serves can
 * never reach it (ADR-0008). It gives a view two things: `firstmate.ask`,
 * which sends one string, and the main process reads it and checks which view
 * sent it; and `firstmate.shown`, which hands the page each body the main
 * process sends it, as a string and nothing else.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { ASK_CHANNEL, SHOW_CHANNEL } from './ask.ts';

contextBridge.exposeInMainWorld('firstmate', {
  ask: (what: unknown): void => {
    if (typeof what === 'string') ipcRenderer.send(ASK_CHANNEL, what);
  },
  shown: (put: unknown): void => {
    if (typeof put !== 'function') return;
    // The page gets the body alone, never the IPC event behind it.
    ipcRenderer.on(SHOW_CHANNEL, (_event, body: unknown) => {
      if (typeof body === 'string') put(body);
    });
  },
});
