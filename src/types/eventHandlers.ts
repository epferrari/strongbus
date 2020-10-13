import {EventKeys, ElementType} from './utility';
import {WILDCARD} from './events';

export type SingleEventHandler<TEventMap extends object, T extends EventKeys<TEventMap>> = (payload: TEventMap[T]) => void;

export type MultiEventHandler<
  TEventMap extends object,
  TEventSubset extends EventKeys<TEventMap>[] = EventKeys<TEventMap>[]
> = <TEvent extends ElementType<TEventSubset>>(event: TEvent, payload: TEventMap[TEvent]) => void;

export type WildcardEventHandler<TEventMap extends object> =
  <T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

export type EventHandler<TEventMap extends object, TEvent> =
  TEvent extends EventKeys<TEventMap>[]
    ? MultiEventHandler<TEventMap, TEvent>
    : TEvent extends EventKeys<TEventMap>
      ? SingleEventHandler<TEventMap, TEvent>
      : TEvent extends WILDCARD
        ? WildcardEventHandler<TEventMap>
        : never;

export type GenericHandler = (...args: any) => void|Promise<void>;



