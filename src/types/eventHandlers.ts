import type {EventKeys} from './utility';
import type {EventMap} from './events';

/**
 * Handler for a single, specific event `T`. Receives only that event's payload
 * (`TEventMap[T]`). This is the handler shape accepted by {@link Bus.on} and
 * {@link Bus.once}.
 *
 * Declared via the `bivarianceHack` indirection so the payload parameter is
 * bivariant; this lets a `Bus` over a wider event map satisfy a view over a
 * narrower one.
 */
export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = {
  bivarianceHack(payload: TEventMap[T]): void;
}['bivarianceHack'];

interface EventSinkObject<in out TEventMap extends EventMap> {
  bivarianceHack(
    event: EventKeys<TEventMap>,
    payload: TEventMap[EventKeys<TEventMap>]
  ): void;
}

/**
 * Handler for any event in `TEventMap`. Receives the raised event as its first
 * argument and that event's payload as its second. This is the handler shape
 * accepted by {@link Bus.any}.
 */
export type EventSink<TEventMap extends EventMap> = EventSinkObject<TEventMap>['bivarianceHack'];

interface PipeSinkObject<in out TEventMap extends EventMap> {
  bivarianceHack: <
    K extends EventKeys<TEventMap> | (string & {})
  >(
    event: K,
    payload: K extends EventKeys<TEventMap> ? TEventMap[K] : unknown
  ) => void;
}

/**
 * Discriminated handler for the function-sink forms of {@link Bus.pipe} and
 * {@link Bus.unpipe}. Known events in `TEventMap` correlate payload types; any
 * other event name is typed as `unknown` so sinks must not assume a uniform
 * payload across all events.
 */
export type PipeSink<TEventMap extends EventMap> = PipeSinkObject<TEventMap>['bivarianceHack'];

/**
 * Internal, untyped handler shape used for the {@link Bus}'s listener bookkeeping.
 * Not part of the public API.
 * @internal
 */
export type GenericHandler = (...args: any) => void|Promise<void>;
