import type {Subscription, EventMap} from './events';
import type {SingleEventHandler} from './eventHandlers';
import type {EventKeys} from './utility';
import type {Lifecycle} from './lifecycle';

export interface Scannable<TEventMap extends EventMap> {
  readonly name: string;
  on<T extends EventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;
  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]
  ) => void): Subscription;
}