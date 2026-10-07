// A fixture that ships mcp.ts beside mcp and mcp.cmd. The Host starts mcp.ts
// first (ADR-0028), and this one is node-form's server, which answers with the
// name of the file it was started from.
import '../node-form/mcp.ts';
