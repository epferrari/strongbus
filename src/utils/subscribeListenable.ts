import {type EventMap, type Subscription, WILDCARD, type Listenable} from '../types/events';
import type {EventHandler, EventSink, TapHandler} from '../types/eventHandlers';
import type {SubscribeOptions, SubscriptionSurfacePipe, SubscriptionSurfaceTap} from '../types/surfaces/subscriptionSurface';
import type {EventKeys, SubscribableEventKeys} from '../types/utility';

export interface ListenableSubscriber<TEventMap extends EventMap> {
  on<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription;
  any<TEvents extends SubscribableEventKeys<TEventMap>[]>(
    events: TEvents,
    handler: EventSink<TEventMap>,
    options?: SubscribeOptions
  ): Subscription;
  pipe: SubscriptionSurfacePipe<TEventMap>;
  tap: SubscriptionSurfaceTap<TEventMap>;
}

export function subscribeListenable<TEventMap extends EventMap>(
  target: ListenableSubscriber<TEventMap>,
  listenable: Listenable<EventKeys<TEventMap>>,
  handler: EventSink<TEventMap>,
  options?: SubscribeOptions
): Subscription {
  if(Array.isArray(listenable)) {
    return target.any(listenable as SubscribableEventKeys<TEventMap>[], handler, options);
  }
  if(listenable === WILDCARD) {
    const sink: TapHandler<TEventMap> = (message) => handler(message.event, message.payload);
    return target.tap(sink, options);
  }
  return target.on(
    listenable as SubscribableEventKeys<TEventMap>,
    (payload) => handler(listenable, payload),
    options
  );
}
