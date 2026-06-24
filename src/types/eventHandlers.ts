import type {EventKeys} from './utility';
import type {EventMap} from './events';

export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = (payload: TEventMap[T]) => void;

export type EventSink<TEventMap extends EventMap> =
  <T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

export type GenericHandler = (...args: any) => void|Promise<void>;
