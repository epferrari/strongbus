import type {EventMap} from '../events';
import type {EventKeys, VoidEventKeys} from '../utility';

/**
 * Emit events and tear down a {@link Bus} instance.
 *
 * Event-map typing is bivariant (no `in out`) so a surface over a wider map is
 * assignable to a narrower view — the same Wide→Narrow shape as {@link Bus}.
 */
export interface ControlSurface<TEventMap extends EventMap = EventMap> {
  /** Emit a `void` event with no payload (or an explicit `null`/`undefined`). */
  emit<T extends VoidEventKeys<TEventMap>>(event: T, payload?: null | undefined): boolean;
  /**
   * Emit an event with its correlated payload. The payload is required for any
   * event whose mapped type is not `void`; correlating it directly (rather than
   * through a rest tuple) lets it type-check even when `TEventMap` is a generic
   * type parameter, or when forwarding by a generic key over a concrete map
   * (`T extends keyof M`).
   */
  emit<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean;
  /**
   * Correlated-tuple form: the `(event, payload)` pair must be one of the
   * `[event, payload]` tuples of `TEventMap`. Use this after discriminating on
   * `event` when both values started as independent unions.
   */
  emit(
    ...args: {[K in EventKeys<TEventMap>]: [event: K, payload: TEventMap[K]]}[EventKeys<TEventMap>]
  ): boolean;

  destroy(): void;
}

/**
 * Unwrap a {@link ControlSurface} or a {@link ControlSurface.Branded} carrier.
 */
export function ControlSurface<T extends EventMap>(
  s: ControlSurface<T> | ControlSurface.Branded<T>
): ControlSurface<T> {
  return (ControlSurface.BRAND in s ? s[ControlSurface.BRAND] : s) as ControlSurface<T>;
}

export namespace ControlSurface {
  export const BRAND = '@@ControlSurface';

  /** An object that exposes a {@link ControlSurface} under {@link BRAND}. */
  export type Branded<T extends EventMap = EventMap> = {
    readonly [BRAND]: ControlSurface<T>;
  };
}
