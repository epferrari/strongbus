import {StringKeys, ElementType} from './utility';
import {WILDCARD} from './events';

export type SingleEventHandler<TEventMap extends object, T extends StringKeys<TEventMap>> = (payload: TEventMap[T]) => void;

export type MultiEventHandler<
  TEventMap extends object,
  TEventSubset extends StringKeys<TEventMap>[] = StringKeys<TEventMap>[]
> = <TEvent extends ElementType<TEventSubset>>(event: TEvent, payload: TEventMap[TEvent]) => void;

export type WildcardEventHandler<TEventMap extends object> =
  <T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

export type EventHandler<TEventMap extends object, TEvent> =
  TEvent extends StringKeys<TEventMap>[]
    ? MultiEventHandler<TEventMap, TEvent>
    : TEvent extends StringKeys<TEventMap>
      ? SingleEventHandler<TEventMap, TEvent>
      : TEvent extends WILDCARD
        ? WildcardEventHandler<TEventMap>
        : never;



