import {Subscription, EventMap} from './events';
import {SingleEventHandler} from './eventHandlers';
import {EventKeys} from './utility';
import {Lifecycle} from './lifecycle';

export interface Scannable<TEventMap extends EventMap> {
  readonly name: string;
  on<T extends EventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;
  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]
  ) => void): Subscription;
}