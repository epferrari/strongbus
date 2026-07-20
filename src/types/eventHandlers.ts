import type {EventKeys} from './utility';
import type {EventMap} from './events';
import type {Bus} from '../strongbus';

/**
 * Handler for a single, specific event `T`. Receives only that event's payload
 * (`TEventMap[T]`). This is the handler shape accepted by {@link Bus.on} and
 * {@link Bus.once}.
 *
 * Declared via the `bivarianceHack` indirection so the payload parameter is
 * bivariant; this lets a `Bus` over a wider event map satisfy a view over a
 * narrower one.
 */
export type EventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = {
  bivarianceHack(payload: TEventMap[T]): void;
}['bivarianceHack'];

/**
 * @deprecated Use {@link EventHandler} instead.
 */
export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> =
  EventHandler<TEventMap, T>;

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
 * A correlated event message: a discriminated union of `{event, payload}` objects,
 * one per key of `TEventMap`. Because each pair is a single value (a union
 * member), narrowing `event` narrows `payload`. Handed to {@link TapHandler}
 * and {@link PipePredicate}.
 */
export type PipedMessage<TEventMap extends EventMap> = {
  [K in EventKeys<TEventMap>]: {event: K; payload: TEventMap[K]}
}[EventKeys<TEventMap>];

/** @internal Event map carried by a downstream {@link Bus} passed to {@link Bus.pipe}. */
export type InferPipeDownstreamMap<TDownstream> =
  TDownstream extends Bus<infer M extends EventMap> ? M : never;

/** True when `T` is assignable to `string` (includes string literal unions). */
type IsStringy<T> = [T] extends [string] ? true : false;
/** True when `T` is assignable to `boolean` (includes `true` / `false` literals). */
type IsBooly<T> = [T] extends [boolean] ? true : false;
/** True when `T` is assignable to `number` (includes numeric literal unions). */
type IsNumbery<T> = [T] extends [number] ? true : false;

/**
 * True when source and dest payloads are in the same primitive family that may
 * widen one-way under {@link PipePayloadOverlap}: string, boolean, or number
 * (including their literal unions).
 */
type SamePrimitiveFamily<S, D> =
  IsStringy<S> extends true ? IsStringy<D>
  : IsBooly<S> extends true ? IsBooly<D>
  : IsNumbery<S> extends true ? IsNumbery<D>
  : false;

/**
 * Shared-key payload compatibility for {@link Bus.pipe}.
 *
 * Compatible when payloads are identical, or when the source is assignable to
 * the dest and both are in the same primitive family (`string` / `boolean` /
 * `number`, including literal unions such as `'a'|'b' → string` or
 * `1|2 → number`). Object and other structured payloads still require exact
 * match. Source-only events are not required on the target; target-only events
 * are simply never raised by the source.
 */
export type PipePayloadOverlap<TSource extends EventMap, TDownstream extends EventMap> =
  Extract<EventKeys<TSource>, EventKeys<TDownstream>> extends never
    ? unknown
    : {
        [K in Extract<EventKeys<TSource>, EventKeys<TDownstream>>]: [TSource[K]] extends [TDownstream[K]]
          ? [TDownstream[K]] extends [TSource[K]]
            ? true
            : SamePrimitiveFamily<TSource[K], TDownstream[K]>
          : false;
      } extends infer Result
        ? Exclude<Result[keyof Result], true> extends never
          ? unknown
          : never
        : never;

/**
 * Observer for {@link Bus.tap}. Receives each raised event as a correlated
 * {@link PipedMessage}. Does not create a graph edge.
 */
export type TapHandler<in out TEventMap extends EventMap> = {
  bivarianceHack(message: PipedMessage<TEventMap>): void;
}['bivarianceHack'];

/**
 * Predicate for a gated multi-hop pipe edge (`bus.pipe(pred).pipe(dest)`).
 * Return `true` to deliver the passthrough event to the next hop; `false` to drop it.
 */
export type PipePredicate<in out TEventMap extends EventMap> = {
  bivarianceHack(message: PipedMessage<TEventMap>): boolean;
}['bivarianceHack'];

/**
 * Internal, untyped handler shape used for the {@link Bus}'s listener bookkeeping.
 * Not part of the public API.
 * @internal
 */
export type GenericHandler = (...args: any) => void|Promise<void>;
