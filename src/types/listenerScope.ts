/**
 * Selects which handlers are included in listener introspection.
 *
 * `ANY` is equivalent to `OWN | DELEGATE` — handlers registered directly on this
 * bus plus handlers on buses attached with `pipe(bus)`.
 *
 * `DELEGATE` covers listeners on piped {@link Bus} instances only. It does **not**
 * include function sinks from `pipe(handler)`; those are registered as `OWN`
 * wildcard handlers on this bus.
 */
export enum ListenerScope {
  OWN = 1,
  DELEGATE = 2,
  ANY = 3
}
