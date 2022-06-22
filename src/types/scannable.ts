import * as Events from './events';
import * as EventHandlers from './eventHandlers';
import {EventKeys} from './utility';
import {Lifecycle} from './lifecycle';

export interface Scannable<TEventMap extends Events.EventMap> {
  readonly name: string;
  on<T extends Events.Listenable<EventKeys<TEventMap>>>(
    event: T,
    handler: EventHandlers.EventHandler<TEventMap, T>
  ): Events.Subscription;
  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]
  ) => void): Events.Subscription;
}