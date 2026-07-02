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

/**
 * Handler for any event in `TEventMap`. Receives the raised event as its first
 * argument and that event's payload as its second. This is the handler shape
 * accepted by {@link Bus.any}.
 */
export type EventSink<in out TEventMap extends EventMap> = {
  bivarianceHack(
    event: EventKeys<TEventMap>,
    payload: TEventMap[EventKeys<TEventMap>]
  ): void;
}['bivarianceHack'];

/**
 * Discriminated handler for the function-sink forms of {@link Bus.pipe} and
 * {@link Bus.unpipe}. The parameters are a union of `[event, payload]` tuples —
 * one per key of `TEventMap` — so that narrowing `event` (via `if`/`switch`)
 * correlatively narrows `payload` to that event's type:
 *
 * ```ts
 * bus.pipe((event, payload) => {
 *   if (event === 'foo') {
 *     payload; // narrowed to TEventMap['foo']
 *   } else if (event === 'bar') {
 *     payload; // narrowed to TEventMap['bar']
 *   }
 * });
 * ```
 *
 * The union includes a `[never, unknown]` member so that, *before* `event` is
 * discriminated, `payload` is `unknown` — you cannot use it until you've matched
 * a specific event. That member is eliminated as soon as `event` is compared to
 * any real key, so each branch still gets the exact payload type. This also
 * keeps the sink sound when the payload types happen to coincide (e.g. two
 * `string` events), where a plain union would collapse to a usable type; and it
 * means unexpected events forwarded from a wider source are simply skipped
 * rather than mistyped.
 *
 * Declared via the `bivarianceHack` indirection so the parameters are bivariant;
 * this lets a `Bus` over a wider event map satisfy a view over a narrower one.
 */
export type PipeSink<in out TEventMap extends EventMap> = {
  bivarianceHack(
    ...args:
      | {
          [K in EventKeys<TEventMap>]: [event: K, payload: TEventMap[K]]
        }[EventKeys<TEventMap>]
      | [event: never, payload: unknown]
  ): void;
}['bivarianceHack'];

/**
 * Internal, untyped handler shape used for the {@link Bus}'s listener bookkeeping.
 * Not part of the public API.
 * @internal
 */
export type GenericHandler = (...args: any) => void|Promise<void>;
