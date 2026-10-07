// A fixture that ships its Plugin Server as mcp.js alone. The Host starts it
// with its own Node (ADR-0028), and this one is node-form's server, which
// answers with the name of the file it was started from.
import '../node-form/mcp.ts';
