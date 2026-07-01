import type {EventMap} from './events';
import type {EventListenerMapKey, ListenerSet} from './listenerRegistry';
import type {IntrospectionOptions} from './listenerScope';
import type {GenericHandler} from './eventHandlers';

interface IntrospectionSurfaceHasListenersForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): boolean;
}

export type IntrospectionSurfaceHasListenersForEvent<TEventMap extends EventMap> =
  IntrospectionSurfaceHasListenersForEventObject<TEventMap>['bivarianceHack'];

interface IntrospectionSurfaceListenerForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): ListenerSet;
}

export type IntrospectionSurfaceListenerForEvent<TEventMap extends EventMap> =
  IntrospectionSurfaceListenerForEventObject<TEventMap>['bivarianceHack'];

interface IntrospectionSurfaceListenerCountForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, options?: IntrospectionOptions): number;
}

export type IntrospectionSurfaceListenerCountForEvent<TEventMap extends EventMap> =
  IntrospectionSurfaceListenerCountForEventObject<TEventMap>['bivarianceHack'];

interface IntrospectionSurfaceListenerForEachObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    TMap extends {[K in keyof TEventMap]: TEventMap[K]}
  >(
    fn: (event: EventListenerMapKey<TMap>, handlers: ListenerSet) => void,
    options?: IntrospectionOptions
  ): void;
}

export type IntrospectionSurfaceListenerForEach<TEventMap extends EventMap> =
  IntrospectionSurfaceListenerForEachObject<TEventMap>['bivarianceHack'];

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
