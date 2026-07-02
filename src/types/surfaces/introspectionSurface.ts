import type {EventMap} from '../events';
import type {EventListenerMapKey, ListenerSet} from '../listenerRegistry';
import type {IntrospectionOptions} from '../listenerScope';
import type {GenericHandler} from '../eventHandlers';

export type IntrospectionSurfaceHasListenersForEvent<in out TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): boolean;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerForEvent<in out TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): ListenerSet;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerCountForEvent<in out TEventMap extends EventMap> = {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): number;
}['bivarianceHack'];

export type IntrospectionSurfaceListenerForEach<in out TEventMap extends EventMap> = {
  bivarianceHack<
    TMap extends {[K in keyof TEventMap]: TEventMap[K]}
  >(
    fn: (event: EventListenerMapKey<TMap>, handlers: ListenerSet) => void,
    options?: IntrospectionOptions
  ): void;
}['bivarianceHack'];

/**
 * Inspect listener registrations on a {@link Bus} or {@link SubscriptionSurface}.
 */
export interface IntrospectionSurface<in out TEventMap extends EventMap = EventMap> {
  hasListeners(options?: IntrospectionOptions): boolean;

  getListenerCount(options?: IntrospectionOptions): number;

  getListeners(options?: IntrospectionOptions): ReadonlySet<GenericHandler>;

  getEventCount(options?: IntrospectionOptions): number;

  hasListenersFor: IntrospectionSurfaceHasListenersForEvent<TEventMap>;

  getListenerCountFor: IntrospectionSurfaceListenerCountForEvent<TEventMap>;

  getListenersFor: IntrospectionSurfaceListenerForEvent<TEventMap>;

  forEach: IntrospectionSurfaceListenerForEach<TEventMap>;
}
