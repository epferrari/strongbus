import type {EventMap} from '../events';
import type {EventKeys, VoidEventKeys} from '../utility';

/**
 * Emit events and tear down a {@link Bus} instance.
 */
export interface ControlSurface<in out TEventMap extends EventMap = EventMap> {
  /** Emit a `void` event with no payload (or an explicit `null`/`undefined`). */
  emit<T extends VoidEventKeys<TEventMap>>(event: T, payload?: null | undefined): boolean;
  /**
   * Emit an event with its correlated payload. The payload is required for any
   * event whose mapped type is not `void`; correlating it directly (rather than
   * through a rest tuple) lets it type-check even when `TEventMap` is a generic
   * type parameter.
   */
  emit<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean;

  destroy(): void;
}
