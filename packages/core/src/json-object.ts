/**
 * One line of JSON, read as an object. An Agent writes its answer as JSON
 * lines and a Conversation is kept as JSON lines, and both read a line the
 * same way: an object, or nothing at all, so a line that is not one is
 * passed over or refused by the reader, never thrown at it.
 */

/** One line, as a JSON object, or nothing when it is not one. */
export function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
