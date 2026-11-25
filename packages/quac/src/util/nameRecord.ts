/**
 * An empty record to file values by a name a project gives, such as a field's
 * or a style's, with no properties of its own to inherit: a field named
 * `__proto__` is then a key like any other rather than the record's
 * prototype, and one named `constructor` reads as absent until it is set.
 */
export function nameRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}
