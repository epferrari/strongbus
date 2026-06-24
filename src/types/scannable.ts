import type {Subscription, EventMap} from './events';
import type {SingleEventHandler} from './eventHandlers';
import type {SubscribableEventKeys} from './utility';
import type {Lifecycle} from './lifecycle';

interface ScannableHookObject<in out TEventMap extends EventMap> {
  bivarianceHack<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]) => void
  ): Subscription;
}

export type ScannableHook<TEventMap extends EventMap> =
  ScannableHookObject<TEventMap>['bivarianceHack'];

export interface Scannable<in out TEventMap extends EventMap = EventMap> {
  readonly name: string;
  on<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;
  hook: ScannableHook<TEventMap>;
}
