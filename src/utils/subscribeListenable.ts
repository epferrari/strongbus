import * as Events from '../types/events';
import * as EventHandlers from '../types/eventHandlers';
import {EventKeys} from '../types/utility';

export interface ListenableSubscriber<TEventMap extends Events.EventMap> {
  on<T extends EventKeys<TEventMap>>(event: T, handler: (payload: TEventMap[T]) => void): Events.Subscription;
  any<TEvents extends EventKeys<TEventMap>[]>(
    events: TEvents,
    handler: EventHandlers.MultiEventHandler<TEventMap, TEvents>
  ): Events.Subscription;
  pipe(handler: EventHandlers.WildcardEventHandler<TEventMap>): Events.Subscription;
}

export function subscribeListenable<TEventMap extends Events.EventMap>(
  target: ListenableSubscriber<TEventMap>,
  listenable: Events.Listenable<EventKeys<TEventMap>>,
  handler: (event: EventKeys<TEventMap>, payload: TEventMap[EventKeys<TEventMap>]) => void
): Events.Subscription {
  if(Array.isArray(listenable)) {
    return target.any(listenable, handler);
  }
  if(listenable === Events.WILDCARD) {
    return target.pipe(handler);
  }
  return target.on(listenable, (payload) => handler(listenable, payload));
}
