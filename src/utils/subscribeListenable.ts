import {type EventMap, type Subscription, WILDCARD} from '../types/events';
import type {SingleEventHandler, EventSink} from '../types/eventHandlers';
import type {EventKeys} from '../types/utility';

export interface ListenableSubscriber<TEventMap extends EventMap> {
  on<T extends EventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;
  any<TEvents extends EventKeys<TEventMap>[]>(events: TEvents, handler: EventSink<TEventMap>): Subscription;
  pipe(handler: EventSink<TEventMap>): Subscription;
}

export function subscribeListenable<TEventMap extends EventMap>(
  target: ListenableSubscriber<TEventMap>,
  listenable: Listenable<EventKeys<TEventMap>>,
  handler: (event: EventKeys<TEventMap>, payload: TEventMap[EventKeys<TEventMap>]) => void
): Subscription {
  if(Array.isArray(listenable)) {
    return target.any(listenable, handler);
  }
  if(listenable === WILDCARD) {
    return target.pipe(handler);
  }
  return target.on(listenable, (payload) => handler(listenable, payload));
}
