/**
 * The Host, as the command line's package starts it.
 *
 * The Host lives in `packages/host`, and starts as it is imported. This file
 * exists so that the Host's entry point sits beside the command line, in a
 * clone and in the build alike: `firstmate start` imports it, the service unit
 * names it, and the Tray reads `cli` beside the `main` the unit names.
 */
import '@firstmate/host/main';
