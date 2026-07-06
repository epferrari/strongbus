import type {EventMap} from '../events';
import type {EventKeys, IsUnion, VoidEventKeys} from '../utility';

/**
 * Emit events and tear down a {@link Bus} instance.
 */
export interface ControlSurface<in out TEventMap extends EventMap = EventMap> {
  /** Emit a `void` event with no payload (or an explicit `null`/`undefined`). */
  emit<T extends VoidEventKeys<TEventMap>>(event: T, payload?: null | undefined): boolean;
  /**
   * Emit a single event with its correlated payload. `event` must be a single
   * key — a literal or a generic type parameter — so the payload correlates
   * directly, which type-checks even when `TEventMap` is itself generic (e.g. a
   * `Bus<TEvents>` inside a generic base class). A union-typed `event` is rejected
   * here (its `IsUnion` guard collapses to `never`) and falls through to the
   * correlated-tuple overload below.
   */
  emit<T extends EventKeys<TEventMap>>(
    event: IsUnion<T> extends true ? never : T,
    payload: TEventMap[T]
  ): boolean;
  /**
   * Correlated-tuple form: the `(event, payload)` pair must be one of the
   * `[event, payload]` tuples of `TEventMap`, so a union-typed `event` can no
   * longer be paired with a union-typed `payload` without first discriminating on
   * `event` — the pattern that let an un-narrowed pipe sink forward a mismatched
   * pair. Also serves a genuinely generic `event` key (where the guard above
   * defers), e.g. forwarding `emit(event, payload)` by key.
   */
  emit(
    ...args: {[K in EventKeys<TEventMap>]: [event: K, payload: TEventMap[K]]}[EventKeys<TEventMap>]
  ): boolean;

  destroy(): void;
}
