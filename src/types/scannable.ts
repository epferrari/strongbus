import * as Events from './events';
import * as EventHandlers from './eventHandlers';
import {EventKeys} from './utility';
import {Lifecycle} from './lifecycle';

export interface Scannable<TMap extends object> {
  readonly name: string;
  on<T extends Events.Listenable<EventKeys<TMap>>>(
    event: T,
    handler: EventHandlers.EventHandler<TMap, T>
  ): Events.Subscription;
  hook(
    event: Lifecycle,
    handler: (targetEvent: EventKeys<TMap>) => void
  ): Events.Subscription;
}