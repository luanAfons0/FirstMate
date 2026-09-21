/**
 * A machine where the webview library will not load, made on purpose.
 *
 * The desktop program takes the only dependency FirstMate has, and the Host
 * must not (ADR-0011). On this machine the native binary genuinely cannot load,
 * for want of WebKit, but that is an accident of one machine. This makes the
 * same condition anywhere: every attempt to resolve the library fails, exactly
 * as a missing or unloadable binary fails.
 *
 * It is loaded into a command with `node --import`, so nothing about the Host
 * is imported here and the command under test is still a real process.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@webviewjs/webview' || specifier.startsWith('@webviewjs/webview/')) {
      throw new Error('Cannot find native binding.');
    }
    return next(specifier, context);
  },
});
