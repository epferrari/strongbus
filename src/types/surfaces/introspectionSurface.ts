import type {EventMap} from '../events';
import type {EventListenerMapKey, ListenerSet} from '../listenerRegistry';
import type {IntrospectionOptions} from '../listenerScope';
import type {GenericHandler} from '../eventHandlers';

export type IntrospectionSurfaceHasListenersForEvent<TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): boolean;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerForEvent<TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): ListenerSet;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerCountForEvent<TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): number;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerForEach<TEventMap extends EventMap> = {
  bivarianceHack<
    TMap extends {[K in keyof TEventMap]: TEventMap[K]}
  >(
    fn: (event: EventListenerMapKey<TMap>, handlers: ListenerSet) => void,
    options?: IntrospectionOptions
  ): void;
}['bivarianceHack'];

/**
 * Inspect listener registrations on a {@link Bus} or {@link SubscriptionSurface}.
 *
 * Event-map typing is bivariant (no `in out`) so a surface over a wider map is
 * assignable to a narrower view — the same Wide→Narrow shape as {@link Bus}.
 */
export interface IntrospectionSurface<TEventMap extends EventMap = EventMap> {
  hasListeners(options?: IntrospectionOptions): boolean;

  getListenerCount(options?: IntrospectionOptions): number;

  getListeners(options?: IntrospectionOptions): ReadonlySet<GenericHandler>;

  getEventCount(options?: IntrospectionOptions): number;

  hasListenersFor: IntrospectionSurfaceHasListenersForEvent<TEventMap>;

  getListenerCountFor: IntrospectionSurfaceListenerCountForEvent<TEventMap>;

  getListenersFor: IntrospectionSurfaceListenerForEvent<TEventMap>;

  forEach: IntrospectionSurfaceListenerForEach<TEventMap>;
}

/**
 * Unwrap a {@link IntrospectionSurface} or a {@link IntrospectionSurface.Branded} carrier.
 */
export function IntrospectionSurface<T extends EventMap>(
  s: IntrospectionSurface<T> | IntrospectionSurface.Branded<T>
): IntrospectionSurface<T> {
  return (
    IntrospectionSurface.BRAND in s ? s[IntrospectionSurface.BRAND] : s
  ) as IntrospectionSurface<T>;
}

export namespace IntrospectionSurface {
  export const BRAND = '@@IntrospectionSurface';

  /** An object that exposes a {@link IntrospectionSurface} under {@link BRAND}. */
  export type Branded<T extends EventMap = EventMap> = {
    readonly [BRAND]: IntrospectionSurface<T>;
  };
}
