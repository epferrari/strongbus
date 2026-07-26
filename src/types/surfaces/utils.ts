/**
 * @internal
 */
export function brand<
  T extends 'Control' | 'Emitting' | 'Introspection' | 'Monitoring' | 'Subscription'
>(type: T): `@@Strongbus${T}Surface` {
  return `@@Strongbus${type}Surface`;
}

/**
 * @internal
 * Unwrap a branded carrier, or return `s` when it is already the surface.
 *
 * Uses property access (not `in`) so Proxy carriers that only implement a `get`
 * trap still unwrap. The duck-check rejects truthy stubs that a Proxy may return
 * for unknown keys.
 */
export function unwrapSurface<T>(
  s: object,
  brandKey: PropertyKey,
  isSurface: (value: unknown) => value is T
): T {
  const branded = (s as Record<PropertyKey, unknown>)[brandKey];
  return isSurface(branded) ? branded : (s as T);
}

/**
 * @internal
 */
export function isObjectWithFunctions(
  value: unknown,
  keys: readonly string[]
): value is object {
  if(value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  for(const key of keys) {
    if(typeof record[key] !== 'function') {
      return false;
    }
  }
  return true;
}
