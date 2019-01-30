import {StringKeys} from './stringKeys';

export type SingleEventHandler<TEventMap extends object, T extends StringKeys<TEventMap>> = (payload: TEventMap[T]) => void;

export type AmbiguousEventHandler = () => void;

export type OnHandler<TEventMap extends object, TEvent> = TEvent extends StringKeys<TEventMap>[]
    ? ProxyHandler<TEventMap>
    : TEvent extends StringKeys<TEventMap>
      ? SingleEventHandler<TEventMap, TEvent>
      : AmbiguousEventHandler;

export type ProxyHandler<TEventMap extends object> = <T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

