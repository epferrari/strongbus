import * as Events from './events';
import * as EventHandlers from './eventHandlers';
import {Lifecycle} from './lifecycle';

export interface Scannable<TMap extends object> {
  readonly name: string;
  on<T extends Events.Listenable<keyof TMap>>(
    event: T,
    handler: EventHandlers.EventHandler<TMap, T>
  ): Events.Subscription;
  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TMap>[L]
  ) => void): Events.Subscription;
}