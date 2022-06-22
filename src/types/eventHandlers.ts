import {EventKeys, ElementType} from './utility';
import {WILDCARD, EventMap} from './events';

export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = (payload: TEventMap[T]) => void;

export type MultiEventHandler<
  TEventMap extends EventMap,
  TEventSubset extends EventKeys<TEventMap>[] = EventKeys<TEventMap>[]
> = <TEvent extends ElementType<TEventSubset>>(event: TEvent, payload: TEventMap[TEvent]) => void;

export type WildcardEventHandler<TEventMap extends EventMap> =
  <T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

export type EventHandler<TEventMap extends EventMap, TEvent> =
  TEvent extends EventKeys<TEventMap>[]
    ? MultiEventHandler<TEventMap, TEvent>
    : TEvent extends EventKeys<TEventMap>
      ? SingleEventHandler<TEventMap, TEvent>
      : TEvent extends WILDCARD
        ? WildcardEventHandler<TEventMap>
        : never;

export type GenericHandler = (...args: any) => void|Promise<void>;



