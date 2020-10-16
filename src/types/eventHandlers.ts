import {ElementType} from './utility';
import {WILDCARD} from './events';

export type SingleEventHandler<TEventMap extends object, T extends keyof TEventMap> = (payload: TEventMap[T]) => void;

export type MultiEventHandler<
  TEventMap extends object,
  TEventSubset extends (keyof TEventMap)[] = (keyof TEventMap)[]
> = <TEvent extends ElementType<TEventSubset>>(event: TEvent, payload: TEventMap[TEvent]) => void;

export type WildcardEventHandler<TEventMap extends object> =
  <T extends keyof TEventMap>(event: T, payload: TEventMap[T]) => void;

export type EventHandler<TEventMap extends object, TEvent> =
  TEvent extends (keyof TEventMap)[]
    ? MultiEventHandler<TEventMap, TEvent>
    : TEvent extends keyof TEventMap
      ? SingleEventHandler<TEventMap, TEvent>
      : TEvent extends WILDCARD
        ? WildcardEventHandler<TEventMap>
        : never;

export type GenericHandler = (...args: any) => void|Promise<void>;



