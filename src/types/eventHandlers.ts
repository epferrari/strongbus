import type {EventKeys} from './utility';
import type {EventMap} from './events';

export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = {
  bivarianceHack(payload: TEventMap[T]): void;
}['bivarianceHack'];

interface EventSinkObject<in out TEventMap extends EventMap> {
  bivarianceHack(
    event: EventKeys<TEventMap>,
    payload: TEventMap[EventKeys<TEventMap>]
  ): void;
}

export type EventSink<TEventMap extends EventMap> = EventSinkObject<TEventMap>['bivarianceHack'];

export type GenericHandler = (...args: any) => void|Promise<void>;
