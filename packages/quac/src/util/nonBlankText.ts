/** The text trimmed, or null where the value is not text or is blank. */
export function readNonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
