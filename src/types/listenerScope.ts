/**
 * Selects which handlers are included in listener introspection.
 *
 * `ANY` is equivalent to `OWN | DOWNSTREAM` — handlers registered directly on this
 * bus plus handlers on buses attached with `pipe(bus)`.
 *
 * `DOWNSTREAM` covers listeners on piped {@link Bus} instances only. It does **not**
 * include function sinks from `pipe(handler)`; those are registered as `OWN`
 * wildcard handlers on this bus.
 */
export enum ListenerScope {
  OWN = 1,
  DOWNSTREAM = 2,
  ANY = 3
}

/**
 * Options accepted by the listener-introspection methods on {@link Bus} /
 * `IntrospectionSurface`. `scope` selects which handlers are included and
 * defaults to {@link ListenerScope.ANY}.
 */
export interface IntrospectionOptions {
  scope?: ListenerScope;
}
