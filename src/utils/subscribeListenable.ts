import {type EventMap, type Subscription, WILDCARD, type Listenable} from '../types/events';
import type {SingleEventHandler, EventSink, PipeSink} from '../types/eventHandlers';
import type {SubscriptionSurfacePipe} from '../types/subscriptionSurface';
import type {EventKeys, SubscribableEventKeys} from '../types/utility';

export interface ListenableSubscriber<TEventMap extends EventMap> {
  on<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;
  any<TEvents extends SubscribableEventKeys<TEventMap>[]>(events: TEvents, handler: EventSink<TEventMap>): Subscription;
  pipe: SubscriptionSurfacePipe<TEventMap>;
}

export function subscribeListenable<TEventMap extends EventMap>(
  target: ListenableSubscriber<TEventMap>,
  listenable: Listenable<EventKeys<TEventMap>>,
  handler: EventSink<TEventMap>
): Subscription {
  if(Array.isArray(listenable)) {
    return target.any(listenable as SubscribableEventKeys<TEventMap>[], handler);
  }
  if(listenable === WILDCARD) {
    return target.pipe(handler as PipeSink<TEventMap>);
  }
  return target.on(listenable as SubscribableEventKeys<TEventMap>, (payload) => handler(listenable, payload));
}
