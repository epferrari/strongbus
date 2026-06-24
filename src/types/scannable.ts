import * as Events from './events';
import {EventKeys} from './utility';
import {Lifecycle} from './lifecycle';

export interface Scannable<TEventMap extends Events.EventMap> {
  readonly name: string;
  on<T extends EventKeys<TEventMap>>(event: T, handler: (payload: TEventMap[T]) => void): Events.Subscription;
  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]
  ) => void): Events.Subscription;
}