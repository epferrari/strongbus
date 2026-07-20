/**
 * Selects which handlers are included in listener introspection.
 *
 * `ANY` is equivalent to `OWN | DOWNSTREAM` — handlers registered directly on this
 * bus plus handlers on buses attached with `pipe(bus)`.
 *
 * `DOWNSTREAM` covers listeners on piped {@link Bus} instances only. It does **not**
 * include `tap` handlers; those are registered as `OWN`
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
 *
 * `includeIncognito` defaults to `false` — incognito own listeners and
 * incognito-piped downstream trees are omitted. Lifecycle / `active` /
 * `monitor` never consult this flag; they always ignore incognito interest.
 */
export interface IntrospectionOptions {
  scope?: ListenerScope;
  /**
   * When `true`, include incognito own handlers and listeners reached via
   * incognito `pipe(bus)` links. Default `false`.
   */
  includeIncognito?: boolean;
}
